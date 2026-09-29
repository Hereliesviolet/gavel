import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL!;

declare global {
  var redis: Redis | undefined;
}

export const redis = global.redis ?? new Redis(redisUrl);

if (process.env.NODE_ENV !== "production") {
  global.redis = redis;
}
