export type AuditAction =
  | "password.change"
  | "profile.email_change"
  | "profile.email_change_request"
  | "profile.email_change_confirm"
  | "profile.email_change_cancel"
  | "session.revoke"
  | "totp.setup_start"
  | "totp.enable"
  | "totp.disable"
  | "totp.backup_regenerate"
  | "admin.audit.read"
  | "admin.quality.read";

const BEST_EFFORT_AUDIT: ReadonlySet<AuditAction> = new Set([
  "admin.audit.read",
  "admin.quality.read",
]);

export function auditWriteIsRequired(action: AuditAction, executor?: unknown): boolean {
  return Boolean(executor) || !BEST_EFFORT_AUDIT.has(action);
}
