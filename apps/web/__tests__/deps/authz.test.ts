import { describe, expect, it } from "vitest";
import { roleIsAdmin } from "@/lib/roles";
import {
  SSO_2FA_LOGIN_PATH,
  ssoIsConfigured,
  ssoLabel,
  ssoProfileAllowed,
  ssoSignInDecision,
} from "@/lib/sso";

describe("roleIsAdmin", () => {
  it("akzeptiert nur die Admin-Rolle", () => {
    expect(roleIsAdmin("admin")).toBe(true);
    expect(roleIsAdmin("user")).toBe(false);
    expect(roleIsAdmin(null)).toBe(false);
    expect(roleIsAdmin(undefined)).toBe(false);
  });
});

describe("sso", () => {
  it("ist nur vollständig konfiguriert aktiv", () => {
    expect(ssoIsConfigured({})).toBe(false);
    expect(
      ssoIsConfigured({
        AUTH_OIDC_ISSUER: "https://idp.example",
        AUTH_OIDC_CLIENT_ID: "id",
      }),
    ).toBe(false);
    expect(
      ssoIsConfigured({
        AUTH_OIDC_ISSUER: "https://idp.example",
        AUTH_OIDC_CLIENT_ID: "id",
        AUTH_OIDC_CLIENT_SECRET: "secret",
      }),
    ).toBe(true);
    expect(ssoLabel({ AUTH_OIDC_NAME: "Entra ID" })).toBe("Entra ID");
    expect(ssoLabel({})).toBe("SSO");
  });

  it("lehnt SSO ab, wenn 2FA aktiv ist", () => {
    expect(ssoSignInDecision(null)).toBe(false);
    expect(ssoSignInDecision({ totpEnabled: false })).toBe(true);
    expect(ssoSignInDecision({ totpEnabled: true })).toBe(SSO_2FA_LOGIN_PATH);
  });

  it("erlaubt SSO nur bei explizit verifizierter IdP-E-Mail", () => {
    expect(ssoProfileAllowed(undefined)).toBe(false);
    expect(ssoProfileAllowed({})).toBe(false);
    expect(ssoProfileAllowed({ email_verified: true })).toBe(true);
    expect(ssoProfileAllowed({ email_verified: false })).toBe(false);
  });
});
