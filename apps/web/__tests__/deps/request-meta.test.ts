import { describe, expect, it } from "vitest";
import {
  extractClientInfo,
  extractClientInfoFromHeaders,
  isTrustedMutationOrigin,
  parseForwardedClientIp,
  rejectUntrustedMutation,
  trustForwardedClientIp,
  trustedMutationHosts,
} from "@/lib/request-meta";

const trustEnv = { TRUST_PROXY_HEADERS: "1", TRUST_PROXY_SECRET: "proxy-token" };

describe("extractClientInfo", () => {
  it("nimmt nur eine einzelne X-Forwarded-For-Adresse hinter dem Proxy", () => {
    const headers = new Headers({
      "user-agent": "Mozilla/5.0",
      "x-forwarded-for": "203.0.113.10",
      "x-gavel-proxy": "proxy-token",
    });
    expect(extractClientInfoFromHeaders(headers, trustEnv)).toEqual({
      userAgent: "Mozilla/5.0",
      ipAddress: "203.0.113.10",
    });
    expect(extractClientInfo(new Request("https://gavel.test", { headers }), trustEnv)).toEqual({
      userAgent: "Mozilla/5.0",
      ipAddress: "203.0.113.10",
    });
    expect(
      parseForwardedClientIp(new Headers({ "x-forwarded-for": "203.0.113.10, 10.0.0.1" })),
    ).toBeNull();
  });

  it("bevorzugt X-Real-IP und ignoriert Client-Header ohne Trust-Flag", () => {
    expect(
      extractClientInfoFromHeaders(
        new Headers({ "x-real-ip": "198.51.100.4", "x-gavel-proxy": "proxy-token" }),
        trustEnv,
      ),
    ).toEqual({ userAgent: null, ipAddress: "198.51.100.4" });
    expect(
      extractClientInfoFromHeaders(new Headers({ "x-forwarded-for": "203.0.113.10" })),
    ).toEqual({ userAgent: null, ipAddress: null });
    expect(extractClientInfoFromHeaders(null)).toEqual({ userAgent: null, ipAddress: null });
    expect(parseForwardedClientIp(new Headers({ "x-real-ip": "not-an-ip" }))).toBeNull();
  });

  it("vertraut Client-IPs nicht ohne Proxy-Secret", () => {
    expect(
      trustForwardedClientIp(new Headers({ "x-real-ip": "198.51.100.4" }), {
        TRUST_PROXY_HEADERS: "1",
      }),
    ).toBe(false);
    expect(
      extractClientInfoFromHeaders(new Headers({ "x-real-ip": "198.51.100.4" }), {
        TRUST_PROXY_HEADERS: "1",
      }),
    ).toEqual({ userAgent: null, ipAddress: null });
  });

  it("verlangt das Proxy-Secret, sobald es gesetzt ist", () => {
    const env = { TRUST_PROXY_HEADERS: "1", TRUST_PROXY_SECRET: "proxy-token" };
    expect(trustForwardedClientIp(new Headers({ "x-gavel-proxy": "proxy-token" }), env)).toBe(true);
    expect(trustForwardedClientIp(new Headers({ "x-gavel-proxy": "wrong" }), env)).toBe(false);
    expect(
      extractClientInfoFromHeaders(
        new Headers({ "x-real-ip": "198.51.100.4", "x-gavel-proxy": "wrong" }),
        env,
      ),
    ).toEqual({ userAgent: null, ipAddress: null });
  });
});

describe("isTrustedMutationOrigin", () => {
  it("akzeptiert gleiche Origin oder Referer und lehnt fremde Hosts ab", () => {
    expect(isTrustedMutationOrigin("https://gavel.example.com", null, "gavel.example.com")).toBe(
      true,
    );
    expect(
      isTrustedMutationOrigin(null, "https://gavel.example.com/account", "gavel.example.com"),
    ).toBe(true);
    expect(isTrustedMutationOrigin("https://evil.example", null, "gavel.example.com")).toBe(false);
    expect(isTrustedMutationOrigin(null, null, "gavel.example.com")).toBe(false);
    expect(
      isTrustedMutationOrigin("https://Gavel.example.com", null, "gavel.example.com:443"),
    ).toBe(true);
    expect(
      isTrustedMutationOrigin("https://gavel.example.com:443", null, "GAVEL.example.com"),
    ).toBe(true);
  });

  it("blockiert Mutationen ohne vertrauenswürdige Origin", async () => {
    const denied = rejectUntrustedMutation(
      new Request("https://gavel.example.com/api/alerts", {
        method: "POST",
        headers: { origin: "https://evil.example", host: "gavel.example.com" },
      }),
    );
    expect(denied?.status).toBe(403);
    const allowed = rejectUntrustedMutation(
      new Request("https://gavel.example.com/api/alerts", {
        method: "POST",
        headers: { origin: "https://gavel.example.com", host: "gavel.example.com" },
      }),
    );
    expect(allowed).toBeNull();
  });

  it("bindet Hosts an NEXTAUTH_URL und AUTH_TRUSTED_HOSTS", () => {
    const env = { NEXTAUTH_URL: "https://gavel.example.com" };
    expect(trustedMutationHosts(env)).toEqual(["gavel.example.com"]);
    expect(
      isTrustedMutationOrigin("https://gavel.example.com", null, "gavel.example.com", env),
    ).toBe(true);
    expect(isTrustedMutationOrigin("https://evil.example", null, "evil.example", env)).toBe(false);
    expect(
      isTrustedMutationOrigin("https://evil.example", null, "evil.example", {
        NODE_ENV: "production",
      }),
    ).toBe(false);
    expect(
      isTrustedMutationOrigin("https://preview.example", null, "preview.example", {
        AUTH_TRUSTED_HOSTS: "preview.example",
      }),
    ).toBe(true);
  });
});
