import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export const REVOKED_SESSION_RETENTION_DAYS = 90;
export const AUDIT_EVENT_RETENTION_DAYS = 365;

type SqlExecutor = Pick<typeof db, "execute">;

export async function clearExpiredPendingEmails(executor: SqlExecutor = db): Promise<void> {
  await executor.execute(sql`
    UPDATE users
    SET pending_email = NULL,
        pending_email_token_hash = NULL,
        pending_email_expires_at = NULL,
        updated_at = NOW()
    WHERE pending_email_expires_at IS NOT NULL
      AND pending_email_expires_at < NOW()
  `);
}

export async function pruneExpiredOperationalRows(): Promise<void> {
  await clearExpiredPendingEmails();
  await db.execute(sql`
    DELETE FROM user_login_sessions
    WHERE revoked_at IS NOT NULL
      AND revoked_at < NOW() - (${REVOKED_SESSION_RETENTION_DAYS}::text || ' days')::interval
  `);
  await db.execute(sql`
    DELETE FROM audit_events
    WHERE created_at < NOW() - (${AUDIT_EVENT_RETENTION_DAYS}::text || ' days')::interval
  `);
}
