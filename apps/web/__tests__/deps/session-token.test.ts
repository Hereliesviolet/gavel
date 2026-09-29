import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyJwtUserLookup,
  clampEphemeralJwtExpiry,
  EPHEMERAL_SESSION_SECONDS,
  ephemeralJwtExpired,
  expireEphemeralJwtIdentity,
  isRevokedFromStoreLookups,
  isSessionRevokeRedisError,
  jwtEncodeMaxAgeSeconds,
  jwtHasBoundSession,
  loginSessionMatchesToken,
  PERSISTENT_SESSION_SECONDS,
  persistUntilSeconds,
  SessionRevokeRedisError,
  shouldSkipDbAfterRedisLookup,
} from "@/lib/session-token";

describe("clampEphemeralJwtExpiry", () => {
  it("hält Sitzungen ohne Merken auf festes persistUntil, nicht auf iat", () => {
    const now = 1_800_000_000;
    expect(
      clampEphemeralJwtExpiry({ persist: false, iat: now, exp: now + 30 * 24 * 60 * 60 }, now).exp,
    ).toBe(now + EPHEMERAL_SESSION_SECONDS);
    expect(clampEphemeralJwtExpiry({ persist: true, exp: 99 }, now).exp).toBe(99);
    expect(clampEphemeralJwtExpiry({ persist: false, exp: 0 }, now).exp).toBe(
      now + EPHEMERAL_SESSION_SECONDS,
    );
    const slidingIat = clampEphemeralJwtExpiry(
      { persist: false, persistUntil: now + 100, iat: now + 10_000, exp: now + 99_999 },
      now,
    );
    expect(slidingIat.persistUntil).toBe(now + 100);
    expect(slidingIat.exp).toBe(now + 100);
    expect(jwtEncodeMaxAgeSeconds(slidingIat, PERSISTENT_SESSION_SECONDS, now)).toBe(100);
    expect(jwtEncodeMaxAgeSeconds({ persist: true }, PERSISTENT_SESSION_SECONDS, now)).toBe(
      PERSISTENT_SESSION_SECONDS,
    );
    expect(jwtEncodeMaxAgeSeconds({ persist: false }, PERSISTENT_SESSION_SECONDS, now)).toBe(0);
    expect(persistUntilSeconds({ persistUntil: now + 12 })).toBe(now + 12);
    expect(ephemeralJwtExpired({ persist: false, persistUntil: now }, now)).toBe(true);
    expect(ephemeralJwtExpired({ persist: false, persistUntil: now + 1 }, now)).toBe(false);
    expect(ephemeralJwtExpired({ persist: false }, now)).toBe(true);
    expect(ephemeralJwtExpired({ persist: true, persistUntil: now }, now)).toBe(false);
    const expired = expireEphemeralJwtIdentity(
      { persist: false, persistUntil: now, id: "u1", sid: "s1", role: "user" },
      now,
    );
    expect(expired).toEqual({ persist: false, persistUntil: now });
    expect(
      expireEphemeralJwtIdentity(
        { persist: false, persistUntil: now + 1, id: "u1", sid: "s1" },
        now,
      ),
    ).toEqual({ persist: false, persistUntil: now + 1, id: "u1", sid: "s1" });
    const authSrc = readFileSync(path.join(__dirname, "../../lib/auth.ts"), "utf8");
    expect(authSrc).toContain("jwtEncodeMaxAgeSeconds");
    expect(authSrc).toContain("encode as encodeJwt");
    expect(authSrc).toContain("token.persistUntil");
    expect(authSrc).toContain("expireEphemeralJwtIdentity(clampEphemeralJwtExpiry(token))");
    expect(authSrc).toContain("PERSISTENT_SESSION_SECONDS");
    const proxySrc = readFileSync(path.join(__dirname, "../../proxy.ts"), "utf8");
    expect(proxySrc).toContain("ephemeralJwtExpired(token)");
  });
});

describe("jwtHasBoundSession", () => {
  it("verlangt id und sid", () => {
    expect(jwtHasBoundSession({ id: "user-1", sid: "sess-1" })).toBe(true);
    expect(jwtHasBoundSession({ id: "user-1" })).toBe(false);
    expect(jwtHasBoundSession({ sid: "sess-1" })).toBe(false);
    expect(jwtHasBoundSession({ id: "", sid: "sess-1" })).toBe(false);
    expect(jwtHasBoundSession(null)).toBe(false);
  });
});

describe("isRevokedFromStoreLookups", () => {
  it("sperrt, sobald Redis oder DB den Widerruf kennt", () => {
    expect(isRevokedFromStoreLookups({ ok: true, revoked: true })).toBe(true);
    expect(
      isRevokedFromStoreLookups({ ok: true, revoked: false }, { ok: true, revoked: true }),
    ).toBe(true);
    expect(
      isRevokedFromStoreLookups({ ok: true, revoked: false }, { ok: true, revoked: false }),
    ).toBe(false);
  });

  it("fällt auf die DB zurück und sperrt, wenn die DB nicht bestätigt", () => {
    expect(isRevokedFromStoreLookups({ ok: false }, { ok: true, revoked: true })).toBe(true);
    expect(isRevokedFromStoreLookups({ ok: false }, { ok: true, revoked: false })).toBe(false);
    expect(isRevokedFromStoreLookups({ ok: false })).toBe(true);
    expect(isRevokedFromStoreLookups({ ok: false }, { ok: false })).toBe(true);
    expect(isRevokedFromStoreLookups({ ok: true, revoked: false }, { ok: false })).toBe(true);
    expect(isRevokedFromStoreLookups({ ok: true, revoked: false })).toBe(true);
  });
});

describe("shouldSkipDbAfterRedisLookup", () => {
  it("überspringt die DB nur bei bekanntem Redis-Widerruf, nicht bei Live-Treffer", () => {
    expect(shouldSkipDbAfterRedisLookup({ redisOk: true, redisRevoked: true })).toBe(true);
    expect(shouldSkipDbAfterRedisLookup({ redisOk: true, redisRevoked: false })).toBe(false);
    expect(shouldSkipDbAfterRedisLookup({ redisOk: false, redisRevoked: false })).toBe(false);
  });
});

describe("applyJwtUserLookup", () => {
  it("entfernt Identität und Rolle, wenn die Nutzerzeile fehlt", () => {
    const token = { id: "user-1", sid: "sess-1", role: "admin", persist: true };
    expect(applyJwtUserLookup(token, null)).toEqual({ persist: true });
    expect(jwtHasBoundSession(token)).toBe(false);
  });

  it("übernimmt die aktuelle Rolle aus der Nutzerzeile", () => {
    const token = { id: "user-1", sid: "sess-1", role: "admin" };
    expect(applyJwtUserLookup(token, { role: "user" })).toEqual({
      id: "user-1",
      sid: "sess-1",
      role: "user",
    });
    expect(applyJwtUserLookup({ id: "user-1", sid: "sess-1" }, {})).toEqual({
      id: "user-1",
      sid: "sess-1",
      role: "user",
    });
  });
});

describe("loginSessionMatchesToken", () => {
  it("bindet die Sitzung an denselben Nutzer und lehnt Widerruf ab", () => {
    expect(loginSessionMatchesToken({ userId: "user-1", revokedAt: null }, "user-1")).toBe(true);
    expect(loginSessionMatchesToken({ userId: "user-2", revokedAt: null }, "user-1")).toBe(false);
    expect(loginSessionMatchesToken({ userId: "user-1", revokedAt: new Date() }, "user-1")).toBe(
      false,
    );
    expect(loginSessionMatchesToken(null, "user-1")).toBe(false);
    const authSrc = readFileSync(path.join(__dirname, "../../lib/auth.ts"), "utf8");
    expect(authSrc).toContain("loginSessionMatchesToken(loginSession, token.id)");
    expect(authSrc).toContain("revokeExcessLiveSessionRows");
    expect(authSrc).toContain("createCappedLoginSession");
    const revokeSrc = readFileSync(path.join(__dirname, "../../lib/session-revocation.ts"), "utf8");
    expect(revokeSrc).toContain("loginSessionMatchesToken(row, userId)");
    expect(revokeSrc).toContain("MAX_LIVE_LOGIN_SESSIONS = 10");
    expect(revokeSrc).toContain("revokeExcessLiveSessionRows");
    const sessionsPage = readFileSync(
      path.join(__dirname, "../../app/account/sessions/page.tsx"),
      "utf8",
    );
    expect(sessionsPage).toContain("MAX_LIVE_LOGIN_SESSIONS");
    const proxySrc = readFileSync(path.join(__dirname, "../../proxy.ts"), "utf8");
    expect(proxySrc).toContain("isSessionRevoked(token.sid, token.id)");
    expect(proxySrc).toContain('pathname.startsWith("/api/")');
    expect(proxySrc).toContain('NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 })');
    expect(proxySrc).toContain("isDeniedApiPath");
    expect(proxySrc).toContain('pathname.startsWith("/zvg-images")');
    const logoutSrc = readFileSync(
      path.join(__dirname, "../../app/api/auth/logout/route.ts"),
      "utf8",
    );
    expect(logoutSrc).toContain("eq(userLoginSessions.userId, userId)");
    expect(logoutSrc).toContain("NextResponse.json({ success: true })");
    expect(logoutSrc).not.toContain("redirect(");
  });
});

describe("isSessionRevokeRedisError", () => {
  it("erkennt Redis-Widerrufsfehler unabhängig vom Import", () => {
    expect(isSessionRevokeRedisError(new SessionRevokeRedisError())).toBe(true);
    expect(isSessionRevokeRedisError(new Error("SESSION_REVOKE_REDIS"))).toBe(true);
    expect(
      isSessionRevokeRedisError(Object.assign(new Error("x"), { name: "SessionRevokeRedisError" })),
    ).toBe(true);
    expect(isSessionRevokeRedisError(new Error("db down"))).toBe(false);
    expect(isSessionRevokeRedisError("SESSION_REVOKE_REDIS")).toBe(false);
  });
});
