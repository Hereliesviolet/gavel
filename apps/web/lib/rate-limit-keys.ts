export const LOGIN_ATTEMPT_WINDOW_SECONDS = 10 * 60;
export const LOGIN_ATTEMPT_MAX = 5;
export const LOGIN_RATE_PREFIX = "gavel:login-attempts:";
export const DEFAULT_RATE_PREFIX = "gavel:rate:";

export type RateLimitOptions = {
  max?: number;
  windowSeconds?: number;
  prefix?: string;
  failClosed?: boolean;
};

export const LOGIN_RATE: RateLimitOptions = {
  max: LOGIN_ATTEMPT_MAX,
  windowSeconds: LOGIN_ATTEMPT_WINDOW_SECONDS,
  prefix: LOGIN_RATE_PREFIX,
  failClosed: true,
};

export const LIST_READ_RATE: RateLimitOptions = {
  max: 60,
  windowSeconds: 60,
  failClosed: true,
};

export const ADMIN_READ_RATE: RateLimitOptions = {
  max: 20,
  windowSeconds: 60,
  failClosed: true,
};

export function rateLimitRedisKey(key: string, prefix = DEFAULT_RATE_PREFIX): string {
  return `${prefix}${key}`;
}

export function rateLimitBlocksWhenUnavailable(failClosed?: boolean): boolean {
  return failClosed !== false;
}
