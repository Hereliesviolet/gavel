import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { redis } from "@/lib/redis";
import { isRateLimited, recordRateLimitHit, clearRateLimit } from "@/lib/rate-limit";
import {
  decodePendingTotpSecret,
  encryptTotpSecret,
  generateBackupCodes,
  hashBackupCode,
  totpSetupRedisKey,
  verifyTotpCode,
} from "@/lib/totp";
import { pendingEmailClearFields } from "@/lib/email-change";
import { commitSensitiveAccountChange } from "@/lib/session-revocation";
import { recordAuditEvent } from "@/lib/audit";
import { logServerError } from "@/lib/sentry";
import { rejectUntrustedMutation } from "@/lib/request-meta";
import { readJsonCapped, rejectCappedJson } from "@/lib/request-body";
import { lockAccountUser } from "@/lib/account-lock";
import {
  isStepUpConsumedError,
  reverifyPasswordAgainstLockedUser,
  sessionAuthTime,
  StepUpConsumedError,
  totpEnrollmentBlockedWithoutPassword,
  verifyEnrollmentStepUp,
} from "@/lib/account-step-up";

const CONFIRM_RATE = { max: 8, windowSeconds: 10 * 60, failClosed: true };

const schema = z.object({
  password: z.string().optional(),
  code: z.string().min(6).max(16),
});

export async function POST(req: NextRequest) {
  const csrf = rejectUntrustedMutation(req);
  if (csrf) return csrf;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });
  }

  const rateKey = `totp-confirm:${session.user.id}`;
  if (await isRateLimited(rateKey, CONFIRM_RATE)) {
    return NextResponse.json(
      { error: "Zu viele Versuche. Bitte später erneut versuchen." },
      { status: 429 },
    );
  }
  await recordRateLimitHit(rateKey, CONFIRM_RATE);

  const json = await readJsonCapped(req);
  if (!json.ok) return rejectCappedJson(json);
  const body = json.value;
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Bitte den 6-stelligen Code eingeben." }, { status: 400 });
  }

  try {
    const user = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { totpEnabled: true, passwordHash: true },
    });
    if (!user) {
      return NextResponse.json({ error: "Nutzer nicht gefunden" }, { status: 404 });
    }
    if (user.totpEnabled) {
      return NextResponse.json(
        { error: "Zwei-Faktor-Authentifizierung ist bereits aktiv." },
        { status: 409 },
      );
    }
    if (totpEnrollmentBlockedWithoutPassword(user.passwordHash)) {
      return NextResponse.json({ error: "Bitte zuerst ein Passwort setzen." }, { status: 400 });
    }
    const stepUp = await verifyEnrollmentStepUp({
      user: {
        id: session.user.id,
        passwordHash: user.passwordHash,
        totpEnabled: user.totpEnabled,
        totpSecret: null,
        totpBackupHashes: null,
      },
      password: parsed.data.password,
      authenticatedAt: sessionAuthTime(session),
      rateKey,
      rate: CONFIRM_RATE,
    });
    if (!stepUp.ok) return stepUp.response;

    const stored = await redis.get(totpSetupRedisKey(session.user.id));
    const secret = stored ? decodePendingTotpSecret(stored) : null;
    if (!secret) {
      return NextResponse.json(
        { error: "Die Einrichtung ist abgelaufen. Bitte neu starten." },
        { status: 410 },
      );
    }

    if (!verifyTotpCode(secret, parsed.data.code)) {
      await recordRateLimitHit(rateKey, CONFIRM_RATE);
      return NextResponse.json(
        { error: "Der Code ist ungültig oder abgelaufen." },
        { status: 400 },
      );
    }

    const backupCodes = generateBackupCodes();
    const userId = session.user.id;
    const currentSid = (session as unknown as { sessionId?: string }).sessionId;
    await commitSensitiveAccountChange(
      async (tx) => {
        const locked = await lockAccountUser(tx, userId);
        if (locked.totpEnabled) {
          const err = new Error("TOTP_ALREADY_ENABLED");
          err.name = "TotpAlreadyEnabledError";
          throw err;
        }
        const passwordOk = await reverifyPasswordAgainstLockedUser(locked, parsed.data.password);
        if (!passwordOk.ok) {
          throw new StepUpConsumedError("Aktuelles Passwort ist falsch.");
        }
        await tx
          .update(users)
          .set({
            totpSecret: encryptTotpSecret(secret),
            totpEnabled: true,
            totpConfirmedAt: new Date(),
            totpBackupHashes: backupCodes.map(hashBackupCode),
            updatedAt: new Date(),
            ...pendingEmailClearFields(),
          })
          .where(eq(users.id, userId));
        if (locked.pendingEmail) {
          await recordAuditEvent({
            actorId: userId,
            action: "profile.email_change_cancel",
            request: req,
            executor: tx,
          });
        }
        await recordAuditEvent({
          actorId: userId,
          action: "totp.enable",
          request: req,
          executor: tx,
        });
      },
      userId,
      currentSid,
    );

    try {
      await redis.del(totpSetupRedisKey(userId));
    } catch (error) {
      console.error(
        "[POST /api/account/totp/confirm] Pending-Secret konnte nicht gelöscht werden",
        error,
      );
    }

    await clearRateLimit(rateKey, CONFIRM_RATE);

    return NextResponse.json({ backupCodes });
  } catch (error) {
    if (error instanceof Error && error.name === "TotpAlreadyEnabledError") {
      return NextResponse.json(
        { error: "Zwei-Faktor-Authentifizierung ist bereits aktiv." },
        { status: 409 },
      );
    }
    if (isStepUpConsumedError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Der Code ist ungültig." },
        { status: 400 },
      );
    }
    logServerError("[POST /api/account/totp/confirm]", error);
    return NextResponse.json({ error: "Bestätigung nicht möglich" }, { status: 500 });
  }
}
