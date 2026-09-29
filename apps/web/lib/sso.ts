import { SSO_2FA_REQUIRED_CODE } from "@/lib/auth-codes";

export const SSO_PROVIDER_ID = "sso";
export const SSO_2FA_LOGIN_PATH = `/login?error=${SSO_2FA_REQUIRED_CODE}`;

type EnvMap = Record<string, string | undefined>;

export function ssoIsConfigured(env: EnvMap = process.env): boolean {
  return Boolean(env.AUTH_OIDC_ISSUER && env.AUTH_OIDC_CLIENT_ID && env.AUTH_OIDC_CLIENT_SECRET);
}

export function ssoLabel(env: EnvMap = process.env): string {
  return env.AUTH_OIDC_NAME?.trim() || "SSO";
}

/** SSO nur für bestehende Konten ohne TOTP; 2FA verlangt Passwort+Code. */
export function ssoSignInDecision(
  user: { totpEnabled?: boolean | null } | null | undefined,
): true | false | string {
  if (!user) return false;
  if (user.totpEnabled) return SSO_2FA_LOGIN_PATH;
  return true;
}

export function ssoProfileAllowed(
  profile: { email_verified?: boolean } | null | undefined,
): boolean {
  return profile?.email_verified === true;
}
