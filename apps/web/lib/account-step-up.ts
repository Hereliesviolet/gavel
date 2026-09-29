import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { recordRateLimitHit, type RateLimitOptions } from "@/lib/rate-limit";
import { verifyTotpOrBackup } from "@/lib/totp";

export type StepUpUser = {
  id: string;
  passwordHash: string | null;
  totpEnabled: boolean;
  totpSecret: string | null;
  totpBackupHashes: string[] | null;
};

export type StepUpOk = { ok: true; remainingHashes?: string[] };

export class StepUpConsumedError extends Error {
  readonly status = 400;

  constructor(message = "Der Code ist ungültig.") {
    super(message);
    this.name = "StepUpConsumedError";
  }
}

export function isStepUpConsumedError(error: unknown): boolean {
  return (
    error instanceof StepUpConsumedError ||
    (error instanceof Error && error.name === "StepUpConsumedError")
  );
}

export function reverifyTotpAgainstLockedUser(
  user: StepUpUser,
  totpCode?: string,
): StepUpOk | { ok: false } {
  if (!user.totpEnabled) return { ok: true };
  if (!totpCode?.trim()) return { ok: false };
  return verifyTotpOrBackup(user.totpSecret, user.totpBackupHashes, totpCode);
}

export async function reverifyPasswordAgainstLockedUser(
  user: Pick<StepUpUser, "passwordHash">,
  password?: string,
): Promise<StepUpOk | { ok: false }> {
  if (!user.passwordHash) return { ok: true };
  if (!password) return { ok: false };
  const passwordOk = await bcrypt.compare(password, user.passwordHash);
  return passwordOk ? { ok: true } : { ok: false };
}

export const ENROLLMENT_FRESH_MS = 10 * 60 * 1000;
const ENROLLMENT_CLOCK_SKEW_MS = 30 * 1000;

export function sessionAuthTime(session: unknown): number | null {
  if (!session || typeof session !== "object") return null;
  const value = (session as { authenticatedAt?: unknown }).authenticatedAt;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function isFreshAuthentication(
  authenticatedAt: Date | string | number | null | undefined,
  now = Date.now(),
): boolean {
  if (authenticatedAt == null) return false;
  const ts =
    typeof authenticatedAt === "number"
      ? authenticatedAt
      : typeof authenticatedAt === "string"
        ? Date.parse(authenticatedAt)
        : authenticatedAt.getTime();
  if (!Number.isFinite(ts)) return false;
  return ts <= now + ENROLLMENT_CLOCK_SKEW_MS && now - ts <= ENROLLMENT_FRESH_MS;
}

export async function verifyPasswordIfPresent(input: {
  user: Pick<StepUpUser, "passwordHash">;
  password?: string;
  rateKey: string;
  rate: RateLimitOptions;
}): Promise<NextResponse | null> {
  if (!input.user.passwordHash) return null;
  if (!input.password) {
    return NextResponse.json({ error: "Bitte das aktuelle Passwort angeben." }, { status: 400 });
  }
  const passwordOk = await bcrypt.compare(input.password, input.user.passwordHash);
  if (passwordOk) return null;
  await recordRateLimitHit(input.rateKey, input.rate);
  return NextResponse.json({ error: "Aktuelles Passwort ist falsch." }, { status: 400 });
}

export async function verifyTotpIfEnabled(input: {
  user: StepUpUser;
  totpCode?: string;
  rateKey: string;
  rate: RateLimitOptions;
}): Promise<StepUpOk | { ok: false; response: NextResponse }> {
  if (!input.user.totpEnabled) return { ok: true };
  if (!input.totpCode?.trim()) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Bitte den Einmalcode oder einen Wiederherstellungscode angeben." },
        { status: 400 },
      ),
    };
  }
  const verified = verifyTotpOrBackup(
    input.user.totpSecret,
    input.user.totpBackupHashes,
    input.totpCode,
  );
  if (!verified.ok) {
    await recordRateLimitHit(input.rateKey, input.rate);
    return {
      ok: false,
      response: NextResponse.json({ error: "Der Code ist ungültig." }, { status: 400 }),
    };
  }
  return { ok: true, remainingHashes: verified.remainingHashes };
}

export async function verifySensitiveStepUp(input: {
  user: StepUpUser;
  password?: string;
  totpCode?: string;
  rateKey: string;
  rate: RateLimitOptions;
}): Promise<StepUpOk | { ok: false; response: NextResponse }> {
  if (!input.user.passwordHash && !input.user.totpEnabled) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Bitte zuerst ein Passwort setzen oder 2FA aktivieren." },
        { status: 400 },
      ),
    };
  }
  const passwordError = await verifyPasswordIfPresent(input);
  if (passwordError) return { ok: false, response: passwordError };
  return verifyTotpIfEnabled(input);
}

export function totpEnrollmentBlockedWithoutPassword(
  passwordHash: string | null | undefined,
): boolean {
  return !passwordHash;
}

export async function verifyEnrollmentStepUp(input: {
  user: StepUpUser;
  password?: string;
  totpCode?: string;
  authenticatedAt?: Date | string | number | null;
  rateKey: string;
  rate: RateLimitOptions;
}): Promise<StepUpOk | { ok: false; response: NextResponse }> {
  if (!input.user.passwordHash && !input.user.totpEnabled) {
    if (!isFreshAuthentication(input.authenticatedAt)) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Bitte erneut anmelden, um diese Änderung zu bestätigen." },
          { status: 403 },
        ),
      };
    }
    return { ok: true };
  }
  const passwordError = await verifyPasswordIfPresent(input);
  if (passwordError) return { ok: false, response: passwordError };
  return verifyTotpIfEnabled(input);
}
