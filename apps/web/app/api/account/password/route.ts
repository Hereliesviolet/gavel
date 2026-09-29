import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { commitSensitiveAccountChange } from "@/lib/session-revocation";
import { passwordPolicyError } from "@/lib/password-policy";
import { clearRateLimit, isRateLimited, recordRateLimitHit } from "@/lib/rate-limit";
import { recordAuditEvent } from "@/lib/audit";
import { logServerError } from "@/lib/sentry";
import { pendingEmailClearFields } from "@/lib/email-change";
import { rejectUntrustedMutation } from "@/lib/request-meta";
import { readJsonCapped, rejectCappedJson } from "@/lib/request-body";
import { lockAccountAndReverifySensitive } from "@/lib/account-lock";
import {
  isStepUpConsumedError,
  sessionAuthTime,
  verifyEnrollmentStepUp,
} from "@/lib/account-step-up";

const PASSWORD_RATE = { max: 5, windowSeconds: 10 * 60, failClosed: true };

const passwordSchema = z
  .object({
    currentPassword: z.string().optional(),
    newPassword: z.string().superRefine((value, ctx) => {
      const policy = passwordPolicyError(value);
      if (policy) ctx.addIssue({ code: z.ZodIssueCode.custom, message: policy });
    }),
    confirmPassword: z.string(),
    totpCode: z.string().optional(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Die Passwörter stimmen nicht überein.",
    path: ["confirmPassword"],
  });

export async function POST(req: NextRequest) {
  const csrf = rejectUntrustedMutation(req);
  if (csrf) return csrf;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });
  }

  const rateKey = `pwd:${session.user.id}`;
  if (await isRateLimited(rateKey, PASSWORD_RATE)) {
    return NextResponse.json(
      { error: "Zu viele Versuche. Bitte in ein paar Minuten erneut versuchen." },
      { status: 429 },
    );
  }
  await recordRateLimitHit(rateKey, PASSWORD_RATE);

  const json = await readJsonCapped(req);
  if (!json.ok) return rejectCappedJson(json);
  const body = json.value;

  const parsed = passwordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe" },
      { status: 400 },
    );
  }

  const { currentPassword, newPassword, totpCode } = parsed.data;

  try {
    const user = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
    });

    if (!user) {
      return NextResponse.json({ error: "Nutzer nicht gefunden" }, { status: 404 });
    }
    if (user.passwordHash && currentPassword && currentPassword === newPassword) {
      return NextResponse.json(
        { error: "Das neue Passwort muss sich vom aktuellen unterscheiden." },
        { status: 400 },
      );
    }

    const totp = await verifyEnrollmentStepUp({
      user,
      password: currentPassword,
      totpCode,
      authenticatedAt: sessionAuthTime(session),
      rateKey,
      rate: PASSWORD_RATE,
    });
    if (!totp.ok) return totp.response;

    const newHash = await bcrypt.hash(newPassword, 12);
    const userId = session.user.id;
    const currentSid = (session as unknown as { sessionId?: string }).sessionId;

    await commitSensitiveAccountChange(
      async (tx) => {
        const locked = await lockAccountAndReverifySensitive(tx, userId, {
          password: currentPassword,
          totpCode,
        });
        await tx
          .update(users)
          .set({
            passwordHash: newHash,
            updatedAt: new Date(),
            ...pendingEmailClearFields(),
            ...(locked.remainingHashes ? { totpBackupHashes: locked.remainingHashes } : {}),
          })
          .where(eq(users.id, userId));
        if (locked.user.pendingEmail) {
          await recordAuditEvent({
            actorId: userId,
            action: "profile.email_change_cancel",
            request: req,
            executor: tx,
          });
        }
        await recordAuditEvent({
          actorId: userId,
          action: "password.change",
          request: req,
          executor: tx,
        });
      },
      userId,
      currentSid,
    );

    await clearRateLimit(rateKey, PASSWORD_RATE);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (isStepUpConsumedError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Der Code ist ungültig." },
        { status: 400 },
      );
    }
    logServerError("[POST /api/account/password]", error);
    return NextResponse.json({ error: "Datenbankfehler" }, { status: 500 });
  }
}
