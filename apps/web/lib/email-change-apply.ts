import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/drizzle/schema";
import { lockAccountUser } from "@/lib/account-lock";
import { commitSensitiveAccountChange } from "@/lib/session-revocation";
import { recordAuditEvent } from "@/lib/audit";
import {
  EMAIL_CONFIRM_QUERY,
  auditEmailRef,
  emailChangeTokensEqual,
  emailConfirmActorMatches,
  hashEmailChangeToken,
  isPostgresUniqueViolation,
  pendingEmailClearFields,
  pendingEmailIsActive,
} from "@/lib/email-change";

export type EmailConfirmResult =
  | { ok: true; userId: string }
  | { ok: false; reason: (typeof EMAIL_CONFIRM_QUERY)[keyof typeof EMAIL_CONFIRM_QUERY] };

class StaleEmailConfirmError extends Error {
  constructor(readonly reason: (typeof EMAIL_CONFIRM_QUERY)[keyof typeof EMAIL_CONFIRM_QUERY]) {
    super(reason);
    this.name = "StaleEmailConfirmError";
  }
}

function isStaleEmailConfirmError(error: unknown): error is StaleEmailConfirmError {
  return error instanceof StaleEmailConfirmError;
}

function clearPendingFields() {
  return {
    ...pendingEmailClearFields(),
    updatedAt: new Date(),
  };
}

async function pendingEmailConflict(
  tx: Pick<typeof db, "select">,
  userId: string,
  nextEmail: string,
): Promise<boolean> {
  const [taken] = await tx
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${nextEmail} AND ${users.id} <> ${userId}`)
    .limit(1);
  return Boolean(taken);
}

export async function confirmPendingEmailChange(
  token: string | undefined,
  request?: Request,
  actorId?: string | null,
): Promise<EmailConfirmResult> {
  const raw = token?.trim() ?? "";
  if (!raw) return { ok: false, reason: EMAIL_CONFIRM_QUERY.invalid };

  const tokenHash = hashEmailChangeToken(raw);
  const user = await db.query.users.findFirst({
    where: eq(users.pendingEmailTokenHash, tokenHash),
    columns: { id: true },
  });
  if (!user || !emailConfirmActorMatches(actorId, user.id)) {
    return { ok: false, reason: EMAIL_CONFIRM_QUERY.invalid };
  }

  const preview = await db.transaction(async (tx) => {
    const locked = await lockAccountUser(tx, user.id);
    if (!emailConfirmActorMatches(actorId, locked.id)) {
      return { ok: false as const, reason: EMAIL_CONFIRM_QUERY.invalid };
    }
    if (!emailChangeTokensEqual(locked.pendingEmailTokenHash, raw) || !locked.pendingEmail) {
      return { ok: false as const, reason: EMAIL_CONFIRM_QUERY.invalid };
    }
    if (!pendingEmailIsActive(locked.pendingEmailExpiresAt)) {
      await tx.update(users).set(clearPendingFields()).where(eq(users.id, locked.id));
      return { ok: false as const, reason: EMAIL_CONFIRM_QUERY.expired };
    }
    const nextEmail = locked.pendingEmail.trim().toLowerCase();
    if (await pendingEmailConflict(tx, locked.id, nextEmail)) {
      return { ok: false as const, reason: EMAIL_CONFIRM_QUERY.conflict };
    }
    return { ok: true as const };
  });
  if (!preview.ok) return preview;

  try {
    await commitSensitiveAccountChange(async (tx) => {
      const locked = await lockAccountUser(tx, user.id);
      if (!emailConfirmActorMatches(actorId, locked.id)) {
        throw new StaleEmailConfirmError(EMAIL_CONFIRM_QUERY.invalid);
      }
      if (!emailChangeTokensEqual(locked.pendingEmailTokenHash, raw) || !locked.pendingEmail) {
        throw new StaleEmailConfirmError(EMAIL_CONFIRM_QUERY.invalid);
      }
      if (!pendingEmailIsActive(locked.pendingEmailExpiresAt)) {
        throw new StaleEmailConfirmError(EMAIL_CONFIRM_QUERY.expired);
      }
      const nextEmail = locked.pendingEmail.trim().toLowerCase();
      if (await pendingEmailConflict(tx, locked.id, nextEmail)) {
        throw new StaleEmailConfirmError(EMAIL_CONFIRM_QUERY.conflict);
      }
      await tx
        .update(users)
        .set({
          email: nextEmail,
          emailVerified: new Date(),
          ...clearPendingFields(),
        })
        .where(eq(users.id, locked.id));
      await recordAuditEvent({
        actorId: locked.id,
        action: "profile.email_change_confirm",
        request,
        metadata: auditEmailRef(nextEmail),
        executor: tx,
      });
    }, user.id);
  } catch (error) {
    if (isStaleEmailConfirmError(error)) {
      return { ok: false, reason: error.reason };
    }
    if (isPostgresUniqueViolation(error)) {
      return { ok: false, reason: EMAIL_CONFIRM_QUERY.conflict };
    }
    throw error;
  }

  return { ok: true, userId: user.id };
}
