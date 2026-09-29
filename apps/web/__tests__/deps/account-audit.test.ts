import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { auditWriteIsRequired } from "@/lib/audit-policy";

function readApp(rel: string): string {
  return readFileSync(path.join(__dirname, "../..", rel), "utf8");
}

describe("sicherheitskritische Audits", () => {
  it("hängen Kontoänderung und Audit in derselben Transaktion", () => {
    const password = readApp("app/api/account/password/route.ts");
    expect(password).toContain("executor: tx");
    expect(password).toContain('action: "password.change"');
    expect(password).toContain("lockAccountAndReverifySensitive");
    expect(password).toContain("password: currentPassword");
    expect(password).toContain('action: "profile.email_change_cancel"');

    const totpEnable = readApp("app/api/account/totp/confirm/route.ts");
    expect(totpEnable).toContain("executor: tx");
    expect(totpEnable).toContain('action: "totp.enable"');
    expect(totpEnable).toContain("lockAccountUser");
    expect(totpEnable).toContain("reverifyPasswordAgainstLockedUser");
    expect(totpEnable).toContain('action: "profile.email_change_cancel"');

    const totpDisable = readApp("app/api/account/totp/disable/route.ts");
    expect(totpDisable).toContain("executor: tx");
    expect(totpDisable).toContain('action: "totp.disable"');
    expect(totpDisable).toContain("lockAccountAndReverifySensitive");
    expect(totpDisable).toContain("password: parsed.data.password");

    const backup = readApp("app/api/account/totp/backup/regenerate/route.ts");
    expect(backup).toContain("executor: tx");
    expect(backup).toContain('action: "totp.backup_regenerate"');
    expect(backup).toContain("lockAccountAndReverifySensitive");
    expect(backup).toContain("password: parsed.data.password");

    const sessions = readApp("app/api/account/sessions/[id]/route.ts");
    expect(sessions).toContain("executor: tx");
    expect(sessions).toContain('action: "session.revoke"');
    expect(sessions.indexOf("recordRateLimitHit(rateKey, SESSION_RATE)")).toBeGreaterThan(0);
    expect(sessions.indexOf("recordRateLimitHit(rateKey, SESSION_RATE)")).toBeLessThan(
      sessions.indexOf("isValidUuid(id)"),
    );

    const audit = readApp("lib/audit.ts");
    expect(audit).toContain("auditWriteIsRequired");
    expect(auditWriteIsRequired("password.change")).toBe(true);
    expect(auditWriteIsRequired("profile.email_change_request")).toBe(true);
    expect(auditWriteIsRequired("totp.setup_start")).toBe(true);
    expect(auditWriteIsRequired("admin.audit.read")).toBe(false);
    expect(auditWriteIsRequired("admin.quality.read")).toBe(false);
    expect(auditWriteIsRequired("admin.audit.read", {} as never)).toBe(true);

    const ssr = readApp("app/account/audit/page.tsx");
    expect(ssr).toContain('action: "admin.audit.read"');

    const profile = readApp("app/api/account/profile/route.ts");
    expect(profile).toContain('action: "profile.email_change_cancel"');
    expect(profile).toContain('action: "profile.email_change_request"');
    expect(profile).toContain("lockAccountAndReverifySensitive");
    expect(profile).toContain("password: currentPassword");
    expect(profile).toContain("executor: tx");
    expect(profile.indexOf("recordRateLimitHit(rateKey, PROFILE_RATE)")).toBeGreaterThan(0);
    expect(profile.indexOf("recordRateLimitHit(rateKey, PROFILE_RATE)")).toBeLessThan(
      profile.indexOf("const json = await readJsonCapped(req)"),
    );

    expect(password.indexOf("recordRateLimitHit(rateKey, PASSWORD_RATE)")).toBeGreaterThan(0);
    expect(password.indexOf("recordRateLimitHit(rateKey, PASSWORD_RATE)")).toBeLessThan(
      password.indexOf("const json = await readJsonCapped(req)"),
    );

    const totpSetup = readApp("app/api/account/totp/setup/route.ts");
    expect(totpSetup.indexOf("recordRateLimitHit(rateKey, SETUP_RATE)")).toBeGreaterThan(0);
    expect(totpSetup.indexOf("recordRateLimitHit(rateKey, SETUP_RATE)")).toBeLessThan(
      totpSetup.indexOf("const json = await readJsonCapped(req)"),
    );

    expect(totpEnable.indexOf("recordRateLimitHit(rateKey, CONFIRM_RATE)")).toBeGreaterThan(0);
    expect(totpEnable.indexOf("recordRateLimitHit(rateKey, CONFIRM_RATE)")).toBeLessThan(
      totpEnable.indexOf("const json = await readJsonCapped(req)"),
    );

    expect(totpDisable.indexOf("recordRateLimitHit(rateKey, DISABLE_RATE)")).toBeGreaterThan(0);
    expect(totpDisable.indexOf("recordRateLimitHit(rateKey, DISABLE_RATE)")).toBeLessThan(
      totpDisable.indexOf("const json = await readJsonCapped(req)"),
    );

    expect(backup.indexOf("recordRateLimitHit(rateKey, REGEN_RATE)")).toBeGreaterThan(0);
    expect(backup.indexOf("recordRateLimitHit(rateKey, REGEN_RATE)")).toBeLessThan(
      backup.indexOf("const json = await readJsonCapped(req)"),
    );

    const confirm = readApp("lib/email-change-apply.ts");
    expect(confirm).toContain("lockAccountUser");
    expect(confirm.indexOf("lockAccountUser")).toBeLessThan(
      confirm.indexOf('action: "profile.email_change_confirm"'),
    );

    const login = readApp("lib/auth.ts");
    expect(login).toContain("lockAccountAndReverifyTotp");
    expect(login).toContain("throw new AuthUnavailableError()");
    expect(login).not.toContain(
      "if (isStepUpConsumedError(error)) return null;\n          return null;",
    );

    const loginForm = readApp("components/auth/login-form.tsx");
    expect(loginForm).toContain("AUTH_UNAVAILABLE_CODE");
    expect(loginForm).toContain("Anmeldung gerade nicht möglich. Bitte später erneut versuchen.");

    const retention = readApp("lib/retention.ts");
    expect(retention).toContain("DELETE FROM user_login_sessions");
    expect(retention).toContain("DELETE FROM audit_events");
    expect(retention).toContain("REVOKED_SESSION_RETENTION_DAYS = 90");
    expect(retention).toContain("AUDIT_EVENT_RETENTION_DAYS = 365");
    expect(retention).toContain("clearExpiredPendingEmails");
    expect(retention).toContain("pending_email_expires_at < NOW()");
  });
});
