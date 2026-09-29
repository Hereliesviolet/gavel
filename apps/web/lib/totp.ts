import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { requireAuthSecret } from "@/lib/auth-secret";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1;

function authSecret(): string {
  return requireAuthSecret();
}

function deriveKey(): Buffer {
  return createHash("sha256").update(authSecret()).digest();
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/=+$/g, "").replace(/[\s-]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of cleaned) {
    const idx = BASE32.indexOf(char);
    if (idx < 0) throw new Error("Ungültiges TOTP-Geheimnis");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter & 0xffffffff, 4);
  const hmac = createHmac("sha1", secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(code % 10 ** digits).padStart(digits, "0");
}

export function generateTotpCode(secretBase32: string, atMs = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / TOTP_STEP_SECONDS);
  return hotp(base32Decode(secretBase32), counter);
}

export function verifyTotpCode(secretBase32: string, code: string, atMs = Date.now()): boolean {
  const normalized = normalizeOtpInput(code);
  if (!/^\d{6}$/.test(normalized)) return false;
  const secret = base32Decode(secretBase32);
  const counter = Math.floor(atMs / 1000 / TOTP_STEP_SECONDS);
  const expected = Buffer.from(normalized, "utf8");
  for (let delta = -TOTP_WINDOW; delta <= TOTP_WINDOW; delta++) {
    const candidate = Buffer.from(hotp(secret, counter + delta), "utf8");
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) {
      return true;
    }
  }
  return false;
}

export function normalizeOtpInput(raw: string): string {
  return raw.replace(/[\s-]/g, "").toLowerCase();
}

export const TOTP_SETUP_REDIS_PREFIX = "gavel:totp-setup:";

export function totpSetupRedisKey(userId: string): string {
  return `${TOTP_SETUP_REDIS_PREFIX}${userId}`;
}

export function decodePendingTotpSecret(stored: string): string | null {
  if (!stored.startsWith("v1:")) return null;
  try {
    return decryptTotpSecret(stored);
  } catch {
    return null;
  }
}

export function encryptTotpSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptTotpSecret(payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Ungültiges TOTP-Geheimnis");
  }
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function buildOtpauthUrl(secret: string, account: string, issuer = "Gavel"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export function generateBackupCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const hex = randomBytes(8).toString("hex");
    codes.push(`${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12)}`);
  }
  return codes;
}

export function hashBackupCode(code: string): string {
  return createHash("sha256")
    .update(authSecret())
    .update(":")
    .update(normalizeOtpInput(code))
    .digest("hex");
}

export function consumeBackupCode(
  hashes: string[] | null | undefined,
  code: string,
): string[] | null {
  if (!hashes?.length) return null;
  const wanted = hashBackupCode(code);
  const wantedBuf = Buffer.from(wanted, "hex");
  let match = -1;
  for (let i = 0; i < hashes.length; i++) {
    const candidate = Buffer.from(hashes[i], "hex");
    if (candidate.length === wantedBuf.length && timingSafeEqual(candidate, wantedBuf)) {
      match = i;
      break;
    }
  }
  if (match < 0) return null;
  return hashes.filter((_, i) => i !== match);
}

function totpCodeMatchesSecret(encryptedSecret: string, code: string): boolean {
  try {
    return verifyTotpCode(decryptTotpSecret(encryptedSecret), code);
  } catch {
    return false;
  }
}

export function verifyTotpOrBackup(
  encryptedSecret: string | null | undefined,
  backupHashes: string[] | null | undefined,
  code: string,
): { ok: true; remainingHashes?: string[] } | { ok: false } {
  if (encryptedSecret && totpCodeMatchesSecret(encryptedSecret, code)) {
    return { ok: true };
  }
  const remaining = consumeBackupCode(backupHashes, code);
  if (!remaining) return { ok: false };
  return { ok: true, remainingHashes: remaining };
}
