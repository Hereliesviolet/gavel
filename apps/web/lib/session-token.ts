export type BoundSessionToken = {
  id: string;
  sid: string;
  role?: unknown;
};

export type SessionStoreLookup = { ok: true; revoked: boolean } | { ok: false };

export function isRevokedFromStoreLookups(
  redis: SessionStoreLookup,
  db?: SessionStoreLookup,
): boolean {
  if (redis.ok && redis.revoked) return true;
  if (!db || !db.ok) return true;
  return db.revoked;
}

export function shouldSkipDbAfterRedisLookup(input: {
  redisOk: boolean;
  redisRevoked: boolean;
}): boolean {
  return input.redisOk && input.redisRevoked;
}

export const EPHEMERAL_SESSION_SECONDS = 12 * 60 * 60;
export const PERSISTENT_SESSION_SECONDS = 30 * 24 * 60 * 60;

function finiteUnixSeconds(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function tokenClaim(token: object | null | undefined, key: string): unknown {
  if (!token) return undefined;
  return (token as Record<string, unknown>)[key];
}

export function persistUntilSeconds(token: object | null | undefined): number | null {
  return finiteUnixSeconds(tokenClaim(token, "persistUntil"));
}

export function jwtEncodeMaxAgeSeconds(
  token: object | null | undefined,
  defaultMaxAge: number,
  nowSec = Math.floor(Date.now() / 1000),
): number {
  if (!token || tokenClaim(token, "persist") !== false) return defaultMaxAge;
  const until = persistUntilSeconds(token);
  if (until == null) return 0;
  return Math.max(0, until - nowSec);
}

export function ephemeralJwtExpired(
  token: object | null | undefined,
  nowSec = Math.floor(Date.now() / 1000),
): boolean {
  if (!token || tokenClaim(token, "persist") !== false) return false;
  const until = persistUntilSeconds(token);
  return until == null || nowSec >= until;
}

export function expireEphemeralJwtIdentity<T extends object>(
  token: T,
  nowSec = Math.floor(Date.now() / 1000),
): T {
  if (!ephemeralJwtExpired(token, nowSec)) return token;
  const next = token as T & { id?: unknown; sid?: unknown; role?: unknown };
  delete next.id;
  delete next.sid;
  delete next.role;
  return token;
}

export function clampEphemeralJwtExpiry<T extends object>(
  token: T,
  nowSec = Math.floor(Date.now() / 1000),
): T {
  const next = token as T & { persist?: unknown; persistUntil?: unknown; exp?: unknown };
  if (next.persist !== false) return token;
  if (persistUntilSeconds(next) == null) {
    next.persistUntil = nowSec + EPHEMERAL_SESSION_SECONDS;
  }
  next.exp = persistUntilSeconds(next) ?? nowSec;
  return token;
}

export function jwtHasBoundSession(token: object | null | undefined): token is BoundSessionToken {
  if (!token) return false;
  const id = "id" in token ? (token as { id?: unknown }).id : undefined;
  const sid = "sid" in token ? (token as { sid?: unknown }).sid : undefined;
  return typeof id === "string" && id.length > 0 && typeof sid === "string" && sid.length > 0;
}

export class SessionRevokeRedisError extends Error {
  constructor(cause?: unknown) {
    super("SESSION_REVOKE_REDIS");
    this.name = "SessionRevokeRedisError";
    if (cause instanceof Error) this.cause = cause;
  }
}

export function isSessionRevokeRedisError(error: unknown): boolean {
  return (
    error instanceof SessionRevokeRedisError ||
    (error instanceof Error &&
      (error.name === "SessionRevokeRedisError" || error.message === "SESSION_REVOKE_REDIS"))
  );
}

export function loginSessionMatchesToken(
  loginSession: { userId?: unknown; revokedAt?: Date | string | null } | null | undefined,
  tokenUserId: string,
): boolean {
  if (!loginSession || loginSession.revokedAt) return false;
  return typeof loginSession.userId === "string" && loginSession.userId === tokenUserId;
}

export function applyJwtUserLookup<T extends object>(
  token: T,
  row: { role?: string | null } | null | undefined,
): T {
  const next = token as T & { id?: unknown; sid?: unknown; role?: unknown };
  if (!row) {
    delete next.id;
    delete next.sid;
    delete next.role;
    return token;
  }
  next.role = row.role ?? "user";
  return token;
}
