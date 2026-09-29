import { afterEach, describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  buildOtpauthUrl,
  consumeBackupCode,
  decodePendingTotpSecret,
  decryptTotpSecret,
  encryptTotpSecret,
  totpSetupRedisKey,
  generateBackupCodes,
  generateTotpCode,
  generateTotpSecret,
  hashBackupCode,
  normalizeOtpInput,
  verifyTotpCode,
  verifyTotpOrBackup,
} from "@/lib/totp";

const PREV_SECRET = process.env.NEXTAUTH_SECRET;

describe("totp", () => {
  afterEach(() => {
    if (PREV_SECRET === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = PREV_SECRET;
  });

  it("kodiert Base32 rund", () => {
    const raw = Buffer.from("Gavel-2FA-secret!!");
    expect(base32Decode(base32Encode(raw)).equals(raw)).toBe(true);
  });

  it("prüft Codes im Zeitfenster und lehnt Tippfehler ab", () => {
    const secret = generateTotpSecret();
    const now = Date.parse("2026-09-12T11:00:00Z");
    const code = generateTotpCode(secret, now);
    expect(verifyTotpCode(secret, code, now)).toBe(true);
    expect(verifyTotpCode(secret, code, now + 30_000)).toBe(true);
    expect(verifyTotpCode(secret, "000000", now)).toBe(false);
    expect(normalizeOtpInput("12 34-56")).toBe("123456");
  });

  it("verschlüsselt das Geheimnis und verbraucht Backup-Codes einmal", () => {
    process.env.NEXTAUTH_SECRET = "test-secret-for-totp";
    const secret = generateTotpSecret();
    const packed = encryptTotpSecret(secret);
    expect(packed.startsWith("v1:")).toBe(true);
    expect(decryptTotpSecret(packed)).toBe(secret);

    const codes = generateBackupCodes(2);
    expect(codes[0]).toMatch(/^[0-9a-f]{4}(-[0-9a-f]{4}){3}$/);
    const hashes = codes.map(hashBackupCode);
    const first = consumeBackupCode(hashes, codes[0]);
    expect(first).toHaveLength(1);
    expect(consumeBackupCode(first, codes[0])).toBeNull();

    const otp = generateTotpCode(secret);
    expect(verifyTotpOrBackup(packed, hashes, otp).ok).toBe(true);
    expect(verifyTotpOrBackup("v1:not-a-valid-secret", hashes, codes[1])).toEqual({
      ok: true,
      remainingHashes: [hashes[0]],
    });
    expect(verifyTotpOrBackup(null, [hashes[0]], codes[0])).toEqual({
      ok: true,
      remainingHashes: [],
    });
    expect(buildOtpauthUrl(secret, "a@b.de")).toContain("otpauth://totp/");
    expect(totpSetupRedisKey("user-1")).toBe("gavel:totp-setup:user-1");
    expect(decodePendingTotpSecret(packed)).toBe(secret);
    expect(decodePendingTotpSecret(secret)).toBeNull();
  });
});
