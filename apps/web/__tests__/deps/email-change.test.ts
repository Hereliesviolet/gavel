import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EMAIL_CHANGE_TTL_MS,
  EMAIL_CONFIRM_COOKIE,
  EMAIL_CONFIRM_HANDOFF_TTL_SECONDS,
  EMAIL_CONFIRM_QUERY,
  MAX_EMAIL_CONFIRM_RID,
  MAX_EMAIL_CONFIRM_TOKEN,
  emailConfirmHandoffRedisKey,
  generateEmailChangeRid,
  isUsableEmailConfirmRid,
  auditEmailRef,
  emailChangeConfirmPath,
  isSafeEmailConfirmUrl,
  emailChangeTokensEqual,
  emailConfirmActorMatches,
  emailConfirmCookieOptions,
  generateEmailChangeToken,
  hashEmailChangeToken,
  isEmailChangeRequest,
  isPostgresUniqueViolation,
  normalizeEmail,
  pendingEmailClearFields,
  pendingEmailIsActive,
} from "@/lib/email-change";
import { nextListingOwnerId, shouldHardDeleteCustomListing } from "@/lib/listing-delete";

const PREV_AUTH = process.env.AUTH_SECRET;
const PREV_NEXT = process.env.NEXTAUTH_SECRET;
const PREV_URL = process.env.NEXTAUTH_URL;

describe("email-change", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = PREV_AUTH || "test-email-pepper";
  });

  afterEach(() => {
    if (PREV_AUTH === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = PREV_AUTH;
    if (PREV_NEXT === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = PREV_NEXT;
    if (PREV_URL === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = PREV_URL;
  });

  it("vergleicht Adressen case-insensitive", () => {
    expect(normalizeEmail("  A@Firma.DE ")).toBe("a@firma.de");
    expect(isEmailChangeRequest("a@firma.de", "A@firma.de")).toBe(false);
    expect(isEmailChangeRequest("a@firma.de", "b@firma.de")).toBe(true);
  });

  it("hasht Tokens vergleichbar und nicht im Klartext", () => {
    const token = generateEmailChangeToken();
    expect(token).toHaveLength(64);
    expect(token.length).toBeLessThanOrEqual(MAX_EMAIL_CONFIRM_TOKEN);
    const hash = hashEmailChangeToken(token);
    expect(hash).not.toBe(token);
    expect(emailChangeTokensEqual(hash, token)).toBe(true);
    expect(emailChangeTokensEqual(hash, generateEmailChangeToken())).toBe(false);
    expect(emailChangeTokensEqual(null, token)).toBe(false);
    expect(hashEmailChangeToken(token, "pepper")).not.toBe(hashEmailChangeToken(token, ""));
  });

  it("hasht nicht ohne Secret", () => {
    delete process.env.AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    expect(() => hashEmailChangeToken("aa")).toThrow(/AUTH_SECRET/);
  });

  it("erkennt abgelaufene Pendings", () => {
    expect(pendingEmailIsActive(new Date(Date.now() + 60_000))).toBe(true);
    expect(pendingEmailIsActive(new Date(Date.now() - 1))).toBe(false);
    expect(pendingEmailIsActive(null)).toBe(false);
    expect(EMAIL_CHANGE_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("leert ausstehende E-Mail-Felder gemeinsam", () => {
    expect(pendingEmailClearFields()).toEqual({
      pendingEmail: null,
      pendingEmailTokenHash: null,
      pendingEmailExpiresAt: null,
    });
  });

  it("bindet die Bestätigung an denselben Nutzer", () => {
    expect(emailConfirmActorMatches("user-a", "user-a")).toBe(true);
    expect(emailConfirmActorMatches("user-b", "user-a")).toBe(false);
    expect(emailConfirmActorMatches(null, "user-a")).toBe(false);
    expect(emailConfirmActorMatches("user-a", null)).toBe(false);
    const apply = readFileSync(path.join(__dirname, "../../lib/email-change-apply.ts"), "utf8");
    expect(apply).toContain("emailConfirmActorMatches(actorId, user.id)");
    expect(apply).toContain("emailConfirmActorMatches(actorId, locked.id)");
    const action = readFileSync(
      path.join(__dirname, "../../app/login/confirm-email/actions.ts"),
      "utf8",
    );
    expect(action).toContain("confirmPendingEmailChange(token, request, session.user.id)");
    expect(action.indexOf("confirmPendingEmailChange")).toBeLessThan(action.indexOf("maxAge: 0"));
    expect(action).toContain("if (result.ok)");
    expect(action).toContain("email-confirm:${session.user.id}");
    expect(action).not.toContain('email-confirm:${ipAddress ?? "unknown"}');
    expect(action.indexOf("const session = await auth()")).toBeLessThan(
      action.indexOf("email-confirm:${session.user.id}"),
    );
    const page = readFileSync(
      path.join(__dirname, "../../app/login/confirm-email/page.tsx"),
      "utf8",
    );
    expect(page).toContain('redirect("/login?callbackUrl=/login/confirm-email")');
  });

  it("baut den Bestätigungspfad unter /login", () => {
    const rid = generateEmailChangeRid();
    expect(rid).toHaveLength(MAX_EMAIL_CONFIRM_RID);
    expect(isUsableEmailConfirmRid(rid)).toBe(true);
    expect(isUsableEmailConfirmRid("not-a-rid")).toBe(false);
    expect(emailChangeConfirmPath(rid)).toBe(`/login/confirm-email?rid=${rid}`);
    process.env.NEXTAUTH_URL = "https://gavel.test";
    expect(isSafeEmailConfirmUrl(`https://gavel.test/login/confirm-email?rid=${rid}`)).toBe(true);
    expect(isSafeEmailConfirmUrl(`https://gavel.test/login/confirm-email?token=${rid}`)).toBe(
      false,
    );
    expect(isSafeEmailConfirmUrl(`https://evil.test/login/confirm-email?rid=${rid}`)).toBe(false);
    expect(isSafeEmailConfirmUrl("javascript:alert(1)")).toBe(false);
    expect(emailConfirmHandoffRedisKey(rid)).toBe(`gavel:email-confirm:${rid}`);
    expect(EMAIL_CONFIRM_HANDOFF_TTL_SECONDS).toBe(24 * 60 * 60);
    expect(emailConfirmCookieOptions().maxAge).toBe(EMAIL_CONFIRM_HANDOFF_TTL_SECONDS);
    expect(EMAIL_CONFIRM_QUERY.throttled).toBe("throttled");
    expect(EMAIL_CONFIRM_COOKIE).toBe("gavel.email-confirm");
  });

  it("schreibt Audit-Referenzen ohne Klartext-E-Mail", () => {
    const a = auditEmailRef("User@Firma.DE");
    const b = auditEmailRef("user@firma.de");
    expect(a.domain).toBe("firma.de");
    expect(a.ref).toMatch(/^[0-9a-f]{12}$/);
    expect(a.ref).toBe(b.ref);
    expect(JSON.stringify(a).toLowerCase()).not.toContain("user@firma.de");
    expect(auditEmailRef("other@firma.de").ref).not.toBe(a.ref);
  });

  it("erkennt Unique-Violations auch in Cause-Ketten", () => {
    expect(isPostgresUniqueViolation({ code: "23505" })).toBe(true);
    expect(isPostgresUniqueViolation({ cause: { code: "23505" } })).toBe(true);
    expect(
      isPostgresUniqueViolation({
        cause: { cause: { cause: { code: "23505" } } },
      }),
    ).toBe(true);
    expect(
      isPostgresUniqueViolation({
        cause: { cause: { cause: { cause: { code: "23505" } } } },
      }),
    ).toBe(false);
    expect(isPostgresUniqueViolation({ code: "23503" })).toBe(false);
    expect(isPostgresUniqueViolation(null)).toBe(false);
  });
});

describe("listing-delete", () => {
  it("löscht private Zeilen nur für den Einreicher", () => {
    expect(
      shouldHardDeleteCustomListing({
        isOwner: true,
        isPrivate: true,
        otherSuccessfulUserIds: ["user-b"],
      }),
    ).toBe(true);
    expect(
      shouldHardDeleteCustomListing({
        isOwner: false,
        isPrivate: true,
        otherSuccessfulUserIds: [],
      }),
    ).toBe(false);
  });

  it("behält geteilte öffentliche Live-Scrapes", () => {
    expect(
      shouldHardDeleteCustomListing({
        isOwner: true,
        isPrivate: false,
        otherSuccessfulUserIds: ["user-b"],
      }),
    ).toBe(false);
    expect(
      shouldHardDeleteCustomListing({
        isOwner: true,
        isPrivate: false,
        otherSuccessfulUserIds: [],
      }),
    ).toBe(true);
    expect(
      nextListingOwnerId([
        { userId: "user-c", requestedAt: new Date("2026-09-12T12:00:00Z") },
        { userId: "user-b", requestedAt: new Date("2026-09-11T08:00:00Z") },
      ]),
    ).toBe("user-b");
    expect(nextListingOwnerId([])).toBeNull();
  });
});

describe("E-Mail-Bestätigung Audit", () => {
  it("schreibt das Audit in derselben Transaktion wie den Adresswechsel", () => {
    const src = readFileSync(path.join(__dirname, "../../lib/email-change-apply.ts"), "utf8");
    expect(src).toContain("executor: tx");
    expect(src).toContain("lockAccountUser");
    expect(src).toContain('action: "profile.email_change_confirm"');
    expect(src.indexOf("commitSensitiveAccountChange")).toBeLessThan(src.indexOf("executor: tx"));

    const profile = readFileSync(
      path.join(__dirname, "../../app/api/account/profile/route.ts"),
      "utf8",
    );
    expect(profile).toContain("lockAccountUser(tx, userId)");
    expect(profile).toContain("eq(users.pendingEmailTokenHash, hashEmailChangeToken(token))");
    expect(profile).toContain("storeEmailConfirmHandoff");
    expect(profile).toContain("emailChangeConfirmPath(rid)");
    expect(profile).toContain("clearExpiredPendingEmails(tx)");
    expect(profile).toContain("lower(${users.email}) = ${email}");
    expect(profile).not.toContain("pendingEmailExpiresAt} > NOW()");
    const schema = readFileSync(path.join(__dirname, "../../drizzle/schema/users.ts"), "utf8");
    expect(schema).toContain('uniqueIndex("users_email_lower_idx")');
    expect(schema).not.toContain("users_pending_email_lower_idx");

    const proxy = readFileSync(path.join(__dirname, "../../proxy.ts"), "utf8");
    expect(proxy).toContain("readEmailConfirmHandoff(rid)");
    expect(proxy).not.toContain("takeEmailConfirmHandoff");
    expect(proxy).toContain('searchParams.get("rid")');
    expect(proxy).not.toContain('searchParams.get("token")');
    expect(proxy).toContain("email=unavailable");
    expect(proxy).toContain("email confirm handoff unavailable");

    const handoff = readFileSync(
      path.join(__dirname, "../../lib/email-confirm-handoff.ts"),
      "utf8",
    );
    expect(handoff).toContain("await redis.get(emailConfirmHandoffRedisKey(rid))");
    expect(handoff).not.toContain("getdel");
    expect(handoff).not.toContain("catch {\n    return null;\n  }");

    const loginForm = readFileSync(
      path.join(__dirname, "../../components/auth/login-form.tsx"),
      "utf8",
    );
    expect(loginForm).toContain('emailStatus === "unavailable"');
    expect(loginForm).toContain(
      "Bestätigung gerade nicht möglich. Bitte den Link später erneut öffnen.",
    );
  });
});
