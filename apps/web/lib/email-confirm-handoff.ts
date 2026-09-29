import { redis } from "@/lib/redis";
import {
  EMAIL_CONFIRM_HANDOFF_TTL_SECONDS,
  MAX_EMAIL_CONFIRM_TOKEN,
  emailConfirmHandoffRedisKey,
  isUsableEmailConfirmRid,
} from "@/lib/email-change";

export async function storeEmailConfirmHandoff(rid: string, token: string): Promise<void> {
  if (!isUsableEmailConfirmRid(rid) || !token.trim()) {
    throw new Error("EMAIL_CONFIRM_HANDOFF");
  }
  const stored = await redis.set(
    emailConfirmHandoffRedisKey(rid),
    token.trim().slice(0, MAX_EMAIL_CONFIRM_TOKEN),
    "EX",
    EMAIL_CONFIRM_HANDOFF_TTL_SECONDS,
    "NX",
  );
  if (stored !== "OK") {
    throw new Error("EMAIL_CONFIRM_HANDOFF");
  }
}

export async function readEmailConfirmHandoff(rid: string): Promise<string | null> {
  if (!isUsableEmailConfirmRid(rid)) return null;
  const token = await redis.get(emailConfirmHandoffRedisKey(rid));
  if (typeof token !== "string" || !token.trim()) return null;
  return token.trim().slice(0, MAX_EMAIL_CONFIRM_TOKEN);
}

export async function deleteEmailConfirmHandoff(rid: string): Promise<void> {
  if (!isUsableEmailConfirmRid(rid)) return;
  try {
    await redis.del(emailConfirmHandoffRedisKey(rid));
  } catch {
    return;
  }
}
