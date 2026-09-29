import { eq, sql } from "drizzle-orm";
import { users } from "@/drizzle/schema";
import { db } from "@/lib/db";
import {
  reverifyPasswordAgainstLockedUser,
  reverifyTotpAgainstLockedUser,
  StepUpConsumedError,
} from "@/lib/account-step-up";

export type AccountLockTx = Pick<typeof db, "execute" | "select">;

export type LockedAccountUser = {
  id: string;
  passwordHash: string | null;
  totpEnabled: boolean;
  totpSecret: string | null;
  totpBackupHashes: string[] | null;
  pendingEmail: string | null;
  pendingEmailTokenHash: string | null;
  pendingEmailExpiresAt: Date | null;
};

export function accountAdvisoryLockKey(userId: string): string {
  return `account:${userId}`;
}

export async function lockAccountUser(
  tx: AccountLockTx,
  userId: string,
): Promise<LockedAccountUser> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${accountAdvisoryLockKey(userId)}))`);
  const [row] = await tx
    .select({
      id: users.id,
      passwordHash: users.passwordHash,
      totpEnabled: users.totpEnabled,
      totpSecret: users.totpSecret,
      totpBackupHashes: users.totpBackupHashes,
      pendingEmail: users.pendingEmail,
      pendingEmailTokenHash: users.pendingEmailTokenHash,
      pendingEmailExpiresAt: users.pendingEmailExpiresAt,
    })
    .from(users)
    .where(eq(users.id, userId));
  if (!row) {
    throw new StepUpConsumedError();
  }
  return row;
}

export async function lockAccountAndReverifyTotp(
  tx: AccountLockTx,
  userId: string,
  totpCode?: string,
): Promise<{ remainingHashes?: string[]; user: LockedAccountUser }> {
  const locked = await lockAccountUser(tx, userId);
  const verified = reverifyTotpAgainstLockedUser(locked, totpCode);
  if (!verified.ok) {
    throw new StepUpConsumedError();
  }
  return { remainingHashes: verified.remainingHashes, user: locked };
}

export async function lockAccountAndReverifySensitive(
  tx: AccountLockTx,
  userId: string,
  input: { password?: string; totpCode?: string },
): Promise<{ remainingHashes?: string[]; user: LockedAccountUser }> {
  const locked = await lockAccountUser(tx, userId);
  const passwordOk = await reverifyPasswordAgainstLockedUser(locked, input.password);
  if (!passwordOk.ok) {
    throw new StepUpConsumedError("Aktuelles Passwort ist falsch.");
  }
  const verified = reverifyTotpAgainstLockedUser(locked, input.totpCode);
  if (!verified.ok) {
    throw new StepUpConsumedError();
  }
  return { remainingHashes: verified.remainingHashes, user: locked };
}
