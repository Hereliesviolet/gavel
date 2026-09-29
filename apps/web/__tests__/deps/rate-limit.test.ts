import { describe, expect, it } from "vitest";
import {
  ADMIN_READ_RATE,
  DEFAULT_RATE_PREFIX,
  LIST_READ_RATE,
  LOGIN_RATE,
  LOGIN_RATE_PREFIX,
  rateLimitBlocksWhenUnavailable,
  rateLimitRedisKey,
} from "@/lib/rate-limit-keys";

describe("rateLimitRedisKey", () => {
  it("trennt Login-Zähler von generischen Limits", () => {
    expect(rateLimitRedisKey("a@b.de:1.2.3.4", LOGIN_RATE_PREFIX)).toBe(
      "gavel:login-attempts:a@b.de:1.2.3.4",
    );
    expect(rateLimitRedisKey("pwd:user-1")).toBe(`${DEFAULT_RATE_PREFIX}pwd:user-1`);
  });

  it("blockiert bei Redis-Ausfall standardmäßig, außer failClosed ist aus", () => {
    expect(rateLimitBlocksWhenUnavailable(undefined)).toBe(true);
    expect(rateLimitBlocksWhenUnavailable(false)).toBe(false);
    expect(rateLimitBlocksWhenUnavailable(true)).toBe(true);
  });

  it("schließt Listen- und Admin-Reads bei Redis-Ausfall", () => {
    expect(LIST_READ_RATE.failClosed).toBe(true);
    expect(LIST_READ_RATE.max).toBe(60);
    expect(ADMIN_READ_RATE.failClosed).toBe(true);
    expect(ADMIN_READ_RATE.max).toBe(20);
  });

  it("schließt Login-Limits bei Redis-Ausfall", () => {
    expect(LOGIN_RATE.failClosed).toBe(true);
    expect(LOGIN_RATE.max).toBe(5);
    expect(LOGIN_RATE.prefix).toBe(LOGIN_RATE_PREFIX);
  });
});
