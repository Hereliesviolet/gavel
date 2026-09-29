import { redis } from "@/lib/redis";
import {
  DEFAULT_RATE_PREFIX,
  LOGIN_ATTEMPT_MAX,
  LOGIN_ATTEMPT_WINDOW_SECONDS,
  rateLimitBlocksWhenUnavailable,
  rateLimitRedisKey,
  type RateLimitOptions,
} from "@/lib/rate-limit-keys";

export {
  ADMIN_READ_RATE,
  DEFAULT_RATE_PREFIX,
  LIST_READ_RATE,
  LOGIN_ATTEMPT_MAX,
  LOGIN_ATTEMPT_WINDOW_SECONDS,
  LOGIN_RATE,
  LOGIN_RATE_PREFIX,
  rateLimitBlocksWhenUnavailable,
  rateLimitRedisKey,
} from "@/lib/rate-limit-keys";
export type { RateLimitOptions } from "@/lib/rate-limit-keys";

export async function isRateLimited(key: string, options: RateLimitOptions = {}): Promise<boolean> {
  const max = options.max ?? LOGIN_ATTEMPT_MAX;
  const prefix = options.prefix ?? DEFAULT_RATE_PREFIX;
  try {
    const count = await redis.get(rateLimitRedisKey(key, prefix));
    return count !== null && Number(count) >= max;
  } catch (e) {
    if (rateLimitBlocksWhenUnavailable(options.failClosed)) {
      console.error("[rate-limit] Check fehlgeschlagen, blockiere Anfrage", e);
      return true;
    }
    console.error("[rate-limit] Check fehlgeschlagen, lasse Anfrage zu", e);
    return false;
  }
}

export async function recordRateLimitHit(
  key: string,
  options: RateLimitOptions = {},
): Promise<void> {
  const windowSeconds = options.windowSeconds ?? LOGIN_ATTEMPT_WINDOW_SECONDS;
  const prefix = options.prefix ?? DEFAULT_RATE_PREFIX;
  try {
    const redisKey = rateLimitRedisKey(key, prefix);
    const count = await redis.incr(redisKey);
    const ttl = await redis.ttl(redisKey);
    if (count === 1 || ttl < 0) {
      await redis.expire(redisKey, windowSeconds);
    }
  } catch (e) {
    if (rateLimitBlocksWhenUnavailable(options.failClosed)) {
      console.error("[rate-limit] Zähler konnte nicht erhöht werden, blockiere Anfrage", e);
      throw e;
    }
    console.error("[rate-limit] Zähler konnte nicht erhöht werden", e);
  }
}

export async function clearRateLimit(key: string, options: RateLimitOptions = {}): Promise<void> {
  const prefix = options.prefix ?? DEFAULT_RATE_PREFIX;
  try {
    await redis.del(rateLimitRedisKey(key, prefix));
  } catch (e) {
    console.error("[rate-limit] Zähler konnte nicht zurückgesetzt werden", e);
  }
}
