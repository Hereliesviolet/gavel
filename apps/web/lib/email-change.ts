import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { requireAuthSecret } from "@/lib/auth-secret";

export const EMAIL_CHANGE_TTL_MS = 24 * 60 * 60 * 1000;
export const EMAIL_CONFIRM_HANDOFF_TTL_SECONDS = Math.ceil(EMAIL_CHANGE_TTL_MS / 1000);
export const MAX_EMAIL_CONFIRM_TOKEN = 128;
export const MAX_EMAIL_CONFIRM_RID = 32;

export const EMAIL_CONFIRM_QUERY = {
  confirmed: "confirmed",
  expired: "expired",
  invalid: "invalid",
  conflict: "conflict",
  throttled: "throttled",
} as const;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isEmailChangeRequest(currentEmail: string, nextEmail: string): boolean {
  return normalizeEmail(currentEmail) !== normalizeEmail(nextEmail);
}

export function generateEmailChangeToken(): string {
  return randomBytes(32).toString("hex");
}

function emailChangePepper(): string {
  return requireAuthSecret();
}

export function hashEmailChangeToken(token: string, pepper = emailChangePepper()): string {
  const hash = createHash("sha256");
  if (pepper) hash.update(pepper);
  hash.update(token);
  return hash.digest("hex");
}

export function emailChangeTokensEqual(
  storedHash: string | null | undefined,
  token: string,
): boolean {
  if (!storedHash) return false;
  const expected = Buffer.from(storedHash, "hex");
  const actual = Buffer.from(hashEmailChangeToken(token), "hex");
  if (expected.length === 0 || expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export function pendingEmailIsActive(
  expiresAt: Date | null | undefined,
  now = new Date(),
): boolean {
  return Boolean(expiresAt && expiresAt.getTime() > now.getTime());
}

export function pendingEmailClearFields() {
  return {
    pendingEmail: null,
    pendingEmailTokenHash: null,
    pendingEmailExpiresAt: null,
  };
}

export function generateEmailChangeRid(): string {
  return randomBytes(16).toString("hex");
}

export function isUsableEmailConfirmRid(rid: string | null | undefined): rid is string {
  const value = rid?.trim() ?? "";
  return value.length === MAX_EMAIL_CONFIRM_RID && /^[0-9a-f]+$/.test(value);
}

export function emailConfirmHandoffRedisKey(rid: string): string {
  return `gavel:email-confirm:${rid}`;
}

export function emailChangeConfirmPath(rid: string): string {
  return `/login/confirm-email?rid=${encodeURIComponent(rid)}`;
}

export function isSafeEmailConfirmUrl(
  raw: string,
  origin = (process.env.NEXTAUTH_URL ?? "").replace(/\/+$/, ""),
): boolean {
  if (!origin) return false;
  try {
    const parsed = new URL(raw);
    const expected = new URL(origin);
    if (parsed.protocol !== "https:" || expected.protocol !== "https:") return false;
    if (parsed.username || parsed.password) return false;
    if (parsed.origin !== expected.origin) return false;
    if (parsed.pathname !== "/login/confirm-email") return false;
    if (parsed.hash) return false;
    const keys = [...parsed.searchParams.keys()];
    if (keys.length !== 1 || keys[0] !== "rid") return false;
    return isUsableEmailConfirmRid(parsed.searchParams.get("rid"));
  } catch {
    return false;
  }
}

export function emailConfirmActorMatches(
  actorId: string | null | undefined,
  ownerId: string | null | undefined,
): boolean {
  return Boolean(actorId && ownerId && actorId === ownerId);
}

export const EMAIL_CONFIRM_COOKIE = "gavel.email-confirm";

export function emailConfirmCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/login/confirm-email",
    maxAge: EMAIL_CONFIRM_HANDOFF_TTL_SECONDS,
  };
}

export function auditEmailRef(email: string): { domain: string; ref: string } {
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf("@");
  return {
    domain: at >= 0 ? normalized.slice(at + 1) : "unknown",
    ref: createHash("sha256")
      .update(emailChangePepper())
      .update(normalized)
      .digest("hex")
      .slice(0, 12),
  };
}

export function isPostgresUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let i = 0; i < 4 && current; i++) {
    if (
      typeof current === "object" &&
      current &&
      "code" in current &&
      (current as { code: unknown }).code === "23505"
    ) {
      return true;
    }
    current =
      typeof current === "object" && current && "cause" in current
        ? (current as { cause: unknown }).cause
        : undefined;
  }
  return false;
}
