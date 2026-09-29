import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  isFreshAuthentication,
  isStepUpConsumedError,
  reverifyPasswordAgainstLockedUser,
  reverifyTotpAgainstLockedUser,
  sessionAuthTime,
  StepUpConsumedError,
  totpEnrollmentBlockedWithoutPassword,
  verifyEnrollmentStepUp,
  verifySensitiveStepUp,
} from "@/lib/account-step-up";
import bcrypt from "bcryptjs";
import { consumeBackupCode, hashBackupCode } from "@/lib/totp";

const ssoUser = {
  id: "u1",
  passwordHash: null,
  totpEnabled: false,
  totpSecret: null,
  totpBackupHashes: null,
};

const rate = { max: 5, windowSeconds: 60, failClosed: true };

describe("verifySensitiveStepUp", () => {
  it("lehnt SSO-Konten ohne Passwort und ohne 2FA ab", async () => {
    const result = await verifySensitiveStepUp({
      user: ssoUser,
      rateKey: "step",
      rate,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      expect(await result.response.json()).toEqual({
        error: "Bitte zuerst ein Passwort setzen oder 2FA aktivieren.",
      });
    }
  });
});

describe("reverifyTotpAgainstLockedUser", () => {
  it("überspringt TOTP, wenn 2FA aus ist, und erkennt verbrauchte Backup-Codes", () => {
    expect(reverifyTotpAgainstLockedUser(ssoUser).ok).toBe(true);
    expect(reverifyTotpAgainstLockedUser({ ...ssoUser, totpEnabled: true }, "123456").ok).toBe(
      false,
    );

    const prev = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = prev || "test-step-up-secret";
    try {
      const hashes = [hashBackupCode("aaaa-bbbb-cccc-dddd")];
      const first = reverifyTotpAgainstLockedUser(
        {
          ...ssoUser,
          totpEnabled: true,
          totpBackupHashes: hashes,
        },
        "aaaa-bbbb-cccc-dddd",
      );
      expect(first.ok).toBe(true);
      if (first.ok) {
        expect(first.remainingHashes).toEqual(consumeBackupCode(hashes, "aaaa-bbbb-cccc-dddd"));
        expect(
          reverifyTotpAgainstLockedUser(
            {
              ...ssoUser,
              totpEnabled: true,
              totpBackupHashes: first.remainingHashes ?? [],
            },
            "aaaa-bbbb-cccc-dddd",
          ).ok,
        ).toBe(false);
      }
    } finally {
      if (prev === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = prev;
    }
  });

  it("erkennt StepUpConsumedError unabhängig vom Import", () => {
    expect(isStepUpConsumedError(new StepUpConsumedError())).toBe(true);
    expect(
      isStepUpConsumedError(Object.assign(new Error("x"), { name: "StepUpConsumedError" })),
    ).toBe(true);
    expect(isStepUpConsumedError(new Error("db down"))).toBe(false);
  });
});

describe("reverifyPasswordAgainstLockedUser", () => {
  it("überspringt SSO ohne Hash und lehnt veraltetes Passwort ab", async () => {
    expect((await reverifyPasswordAgainstLockedUser(ssoUser)).ok).toBe(true);
    expect((await reverifyPasswordAgainstLockedUser({ passwordHash: "x" })).ok).toBe(false);
    const hash = await bcrypt.hash("aktuell", 4);
    expect((await reverifyPasswordAgainstLockedUser({ passwordHash: hash }, "aktuell")).ok).toBe(
      true,
    );
    expect((await reverifyPasswordAgainstLockedUser({ passwordHash: hash }, "alt")).ok).toBe(false);
  });
});

describe("verifyEnrollmentStepUp", () => {
  it("erlaubt SSO-Enrollment nur mit frischer Anmeldung", async () => {
    const stale = await verifyEnrollmentStepUp({
      user: ssoUser,
      authenticatedAt: Date.now() - 20 * 60 * 1000,
      rateKey: "enroll",
      rate,
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.response.status).toBe(403);
    }

    const fresh = await verifyEnrollmentStepUp({
      user: ssoUser,
      authenticatedAt: Date.now() - 30_000,
      rateKey: "enroll",
      rate,
    });
    expect(fresh.ok).toBe(true);
  });

  it("blockiert 2FA-Einrichtung ohne Passwort, lässt Passwort-Setzen zu", () => {
    expect(totpEnrollmentBlockedWithoutPassword(null)).toBe(true);
    expect(totpEnrollmentBlockedWithoutPassword("hash")).toBe(false);
    const setup = readFileSync(
      path.join(__dirname, "../../app/api/account/totp/setup/route.ts"),
      "utf8",
    );
    const confirm = readFileSync(
      path.join(__dirname, "../../app/api/account/totp/confirm/route.ts"),
      "utf8",
    );
    expect(setup).toContain("totpEnrollmentBlockedWithoutPassword(user.passwordHash)");
    expect(confirm).toContain("totpEnrollmentBlockedWithoutPassword(user.passwordHash)");
    const form = readFileSync(
      path.join(__dirname, "../../components/account/totp-form.tsx"),
      "utf8",
    );
    expect(form).toContain("Zwei-Faktor-Authentifizierung braucht ein Passwort");
    expect(form).not.toContain("nur direkt nach der Anmeldung möglich");
    const security = readFileSync(
      path.join(__dirname, "../../app/account/security/page.tsx"),
      "utf8",
    );
    expect(security.indexOf("Passwort festlegen")).toBeLessThan(
      security.indexOf("Zwei-Faktor-Authentifizierung"),
    );
    expect(security.indexOf("PasswordForm")).toBeLessThan(security.indexOf("TotpForm"));
  });

  it("liest die Anmeldezeit nur als Zahl", () => {
    expect(sessionAuthTime({ authenticatedAt: 1_700_000_000_000 })).toBe(1_700_000_000_000);
    expect(sessionAuthTime({ authenticatedAt: "1700000000000" })).toBeNull();
    expect(sessionAuthTime(null)).toBeNull();
    expect(isFreshAuthentication(Date.now() - 2 * 60 * 1000)).toBe(true);
    expect(isFreshAuthentication(Date.now() - 20 * 60 * 1000)).toBe(false);
    expect(isFreshAuthentication(null)).toBe(false);
  });
});
