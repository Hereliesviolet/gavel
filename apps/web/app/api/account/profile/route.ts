import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/drizzle/schema";
import { eq, and, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { recordRateLimitHit, isRateLimited } from "@/lib/rate-limit";
import { recordAuditEvent } from "@/lib/audit";
import { logServerError } from "@/lib/sentry";
import { rejectUntrustedMutation } from "@/lib/request-meta";
import { readJsonCapped, rejectCappedJson } from "@/lib/request-body";
import { lockAccountAndReverifySensitive, lockAccountUser } from "@/lib/account-lock";
import { isStepUpConsumedError, verifySensitiveStepUp } from "@/lib/account-step-up";
import {
  EMAIL_CHANGE_TTL_MS,
  auditEmailRef,
  emailChangeConfirmPath,
  generateEmailChangeRid,
  generateEmailChangeToken,
  hashEmailChangeToken,
  isEmailChangeRequest,
  isPostgresUniqueViolation,
} from "@/lib/email-change";
import { deleteEmailConfirmHandoff, storeEmailConfirmHandoff } from "@/lib/email-confirm-handoff";
import { sendEmailChangeConfirmEmail, sendEmailChangeNoticeEmail } from "@/lib/email";
import { siteUrl } from "@/lib/site-url";
import { clearExpiredPendingEmails } from "@/lib/retention";

const PROFILE_RATE = { max: 10, windowSeconds: 10 * 60, failClosed: true };

const profileSchema = z.object({
  name: z.string().trim().min(1, "Name darf nicht leer sein.").max(120, "Name ist zu lang."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "E-Mail darf nicht leer sein.")
    .email("Bitte eine gültige E-Mail-Adresse angeben."),
  currentPassword: z.string().optional(),
  totpCode: z.string().optional(),
  cancelEmailChange: z.boolean().optional(),
});

function appBaseUrl() {
  return siteUrl();
}

export async function PATCH(req: NextRequest) {
  const csrf = rejectUntrustedMutation(req);
  if (csrf) return csrf;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });
  }
  const userId = session.user.id;

  const rateKey = `profile:${userId}`;
  if (await isRateLimited(rateKey, PROFILE_RATE)) {
    return NextResponse.json(
      { error: "Zu viele Änderungen. Bitte in ein paar Minuten erneut versuchen." },
      { status: 429 },
    );
  }
  await recordRateLimitHit(rateKey, PROFILE_RATE);

  const json = await readJsonCapped(req);
  if (!json.ok) return rejectCappedJson(json);
  const body = json.value;

  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe" },
      { status: 400 },
    );
  }

  const { name, email, currentPassword, totpCode, cancelEmailChange } = parsed.data;

  try {
    const currentUser = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (!currentUser) {
      return NextResponse.json({ error: "Nutzer nicht gefunden" }, { status: 404 });
    }

    const emailChanged = isEmailChangeRequest(currentUser.email ?? "", email);
    if (emailChanged || cancelEmailChange) {
      const stepUp = await verifySensitiveStepUp({
        user: currentUser,
        password: currentPassword,
        totpCode,
        rateKey,
        rate: PROFILE_RATE,
      });
      if (!stepUp.ok) return stepUp.response;
    }

    if (emailChanged) {
      const duplicate = await db.query.users.findFirst({
        where: and(ne(users.id, userId), sql`lower(${users.email}) = ${email}`),
        columns: { id: true },
      });
      if (duplicate) {
        return NextResponse.json(
          { error: "Diese E-Mail-Adresse wird bereits verwendet." },
          { status: 409 },
        );
      }

      const token = generateEmailChangeToken();
      const rid = generateEmailChangeRid();
      const expires = new Date(Date.now() + EMAIL_CHANGE_TTL_MS);
      await db.transaction(async (tx) => {
        await clearExpiredPendingEmails(tx);
        const locked = await lockAccountAndReverifySensitive(tx, userId, {
          password: currentPassword,
          totpCode,
        });
        await tx
          .update(users)
          .set({
            name,
            pendingEmail: email,
            pendingEmailTokenHash: hashEmailChangeToken(token),
            pendingEmailExpiresAt: expires,
            updatedAt: new Date(),
            ...(locked.remainingHashes ? { totpBackupHashes: locked.remainingHashes } : {}),
          })
          .where(eq(users.id, userId));
        await recordAuditEvent({
          actorId: userId,
          action: "profile.email_change_request",
          request: req,
          metadata: auditEmailRef(email),
          executor: tx,
        });
      });

      try {
        await storeEmailConfirmHandoff(rid, token);
        await sendEmailChangeConfirmEmail({
          to: email,
          userName: name,
          confirmUrl: `${appBaseUrl()}${emailChangeConfirmPath(rid)}`,
          expiresHours: EMAIL_CHANGE_TTL_MS / (60 * 60 * 1000),
        });
      } catch (error) {
        await deleteEmailConfirmHandoff(rid);
        await db.transaction(async (tx) => {
          await lockAccountUser(tx, userId);
          await tx
            .update(users)
            .set({
              name: currentUser.name,
              pendingEmail: currentUser.pendingEmail,
              pendingEmailTokenHash: currentUser.pendingEmailTokenHash,
              pendingEmailExpiresAt: currentUser.pendingEmailExpiresAt,
              totpBackupHashes: currentUser.totpBackupHashes,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(users.id, userId),
                eq(users.pendingEmailTokenHash, hashEmailChangeToken(token)),
              ),
            );
        });
        logServerError("[PATCH /api/account/profile] Bestätigungsmail", error);
        return NextResponse.json(
          {
            error:
              "Die Bestätigungsmail konnte nicht gesendet werden. Die Adresse bleibt unverändert.",
          },
          { status: 503 },
        );
      }

      try {
        await sendEmailChangeNoticeEmail({
          to: currentUser.email,
          userName: name,
          newEmail: email,
        });
      } catch (error) {
        console.error(
          "[PATCH /api/account/profile] Hinweismail an bisherige Adresse fehlgeschlagen",
          error,
        );
      }

      return NextResponse.json({
        user: { id: currentUser.id, name, email: currentUser.email },
        emailChangePending: true,
        pendingEmail: email,
      });
    }

    const updated = await db.transaction(async (tx) => {
      const locked = cancelEmailChange
        ? await lockAccountAndReverifySensitive(tx, userId, {
            password: currentPassword,
            totpCode,
          })
        : { remainingHashes: undefined as string[] | undefined };
      const [row] = await tx
        .update(users)
        .set({
          name,
          ...(cancelEmailChange
            ? {
                pendingEmail: null,
                pendingEmailTokenHash: null,
                pendingEmailExpiresAt: null,
              }
            : {}),
          updatedAt: new Date(),
          ...(locked.remainingHashes ? { totpBackupHashes: locked.remainingHashes } : {}),
        })
        .where(eq(users.id, userId))
        .returning({ id: users.id, name: users.name, email: users.email });
      if (!row) return null;
      if (cancelEmailChange) {
        await recordAuditEvent({
          actorId: userId,
          action: "profile.email_change_cancel",
          request: req,
          executor: tx,
        });
      }
      return row;
    });

    if (!updated) {
      return NextResponse.json({ error: "Nutzer nicht gefunden" }, { status: 404 });
    }

    return NextResponse.json({
      user: updated,
      emailChangePending: false,
      pendingEmail: cancelEmailChange ? null : currentUser.pendingEmail,
    });
  } catch (error) {
    if (isStepUpConsumedError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Der Code ist ungültig." },
        { status: 400 },
      );
    }
    if (isPostgresUniqueViolation(error)) {
      return NextResponse.json(
        { error: "Diese E-Mail-Adresse wird bereits verwendet." },
        { status: 409 },
      );
    }
    logServerError("[PATCH /api/account/profile]", error);
    return NextResponse.json({ error: "Datenbankfehler" }, { status: 500 });
  }
}
