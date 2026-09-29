import { describe, expect, it } from "vitest";
import {
  DEFAULT_SITE_URL,
  nominatimUserAgent,
  siteHostname,
  siteIdDomain,
  siteUrl,
} from "@/lib/site-url";

describe("site-url", () => {
  it("fällt ohne NEXTAUTH_URL auf den lokalen Dev-Server zurück", () => {
    expect(siteUrl({})).toBe(DEFAULT_SITE_URL);
    expect(siteUrl({ NEXTAUTH_URL: "  " })).toBe(DEFAULT_SITE_URL);
  });

  it("entfernt abschließende Schrägstriche", () => {
    expect(siteUrl({ NEXTAUTH_URL: "https://gavel.example.com//" })).toBe(
      "https://gavel.example.com",
    );
  });

  it("liefert Hostname und ID-Domain aus derselben Quelle", () => {
    const env = { NEXTAUTH_URL: "https://Gavel.Example.com:8443/app" };
    expect(siteHostname(env)).toBe("gavel.example.com");
    expect(siteIdDomain(env)).toBe("gavel.example.com");
    expect(siteIdDomain({ NEXTAUTH_URL: "kein url" })).toBe("gavel.example");
  });

  it("hängt den Nominatim-Kontakt nur an, wenn er gesetzt ist", () => {
    expect(nominatimUserAgent({})).toBe("Gavel/1.0");
    expect(nominatimUserAgent({ CONTACT_INFO: "ops@example.com" })).toBe(
      "Gavel/1.0 (ops@example.com)",
    );
  });
});
