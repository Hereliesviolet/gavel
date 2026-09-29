import { describe, expect, it, vi } from "vitest";
import {
  isSafeListingImageUrl,
  isSafePublicHttpsUrl,
  isSensitiveQueryKey,
  isUsableCookieHeader,
  listingImageSrc,
  normalizeCookieHeader,
  publicListingImageUrl,
  safeInternalPath,
  indexListingSourceUrls,
  isKnownListingSourceUrl,
  listingSourceUrlKey,
  listingSourceUrlLikePatterns,
  listingSourceUrlPrefixes,
  stripListingIdentityQuery,
  stripSensitiveUrlQuery,
  telemetryRequestPath,
  validateAnalyseUrl,
} from "@/lib/safe-url";

describe("safeInternalPath", () => {
  it("erlaubt relative Pfade", () => {
    expect(safeInternalPath("/analyse")).toBe("/analyse");
    expect(safeInternalPath("/a/b?x=1")).toBe("/a/b?x=1");
  });

  it("blockiert Open Redirects", () => {
    expect(safeInternalPath("https://evil.com")).toBe("/");
    expect(safeInternalPath("//evil.com")).toBe("/");
    expect(safeInternalPath("/\\evil.com")).toBe("/");
    expect(safeInternalPath("/%2f%2fevil.com")).toBe("/");
    expect(safeInternalPath("/investor?next=//evil.com")).toBe("/");
    expect(safeInternalPath(null)).toBe("/");
  });
});

describe("validateAnalyseUrl", () => {
  it("akzeptiert die bekannten Portale", () => {
    const r = validateAnalyseUrl("https://www.immobilienscout24.de/expose/123");
    expect(r.ok).toBe(true);
  });

  it("akzeptiert beliebige öffentliche https-Property-Websites (Phase 2)", () => {
    expect(validateAnalyseUrl("https://www.ein-beliebiger-makler.de/objekt/1").ok).toBe(true);
    expect(validateAnalyseUrl("https://example.com/wohnung").ok).toBe(true);
  });

  it("lehnt http ab (nur https unterstützt)", () => {
    expect(validateAnalyseUrl("http://www.immobilienscout24.de/expose/123").ok).toBe(false);
  });

  it("lehnt interne/private Hosts ab", () => {
    expect(validateAnalyseUrl("https://127.0.0.1/x").ok).toBe(false);
    expect(validateAnalyseUrl("https://192.168.1.1/x").ok).toBe(false);
    expect(validateAnalyseUrl("https://169.254.169.254/latest/meta-data/").ok).toBe(false);
    expect(validateAnalyseUrl("https://[::ffff:127.0.0.1]/x").ok).toBe(false);
    expect(validateAnalyseUrl("https://service.internal/x").ok).toBe(false);
    expect(validateAnalyseUrl("https://printer.local/x").ok).toBe(false);
    expect(validateAnalyseUrl("https://web.default.svc.cluster.local/x").ok).toBe(false);
    expect(validateAnalyseUrl("file:///etc/passwd").ok).toBe(false);
  });

  it("lehnt Zugangsdaten in der URL ab", () => {
    expect(validateAnalyseUrl("https://user:pass@example.de/x").ok).toBe(false);
  });

  it("lehnt dezimale und kurze IPv4-Loopbacks ab", () => {
    expect(validateAnalyseUrl("https://2130706433/x").ok).toBe(false);
    expect(validateAnalyseUrl("https://127.1/x").ok).toBe(false);
  });
});

describe("stripSensitiveUrlQuery", () => {
  it("entfernt Token- und Session-Parameter", () => {
    expect(stripSensitiveUrlQuery("https://portal.example/expose/1?token=abc&keep=1")).toBe(
      "https://portal.example/expose/1?keep=1",
    );
    expect(validateAnalyseUrl("https://portal.example/wohnung?access_token=xyz&id=9")).toEqual({
      ok: true,
      url: "https://portal.example/wohnung?id=9",
    });
    expect(stripSensitiveUrlQuery("https://portal.example/expose/1?shareToken=SECRET&id=9")).toBe(
      "https://portal.example/expose/1?id=9",
    );
    expect(isSensitiveQueryKey("authKey")).toBe(true);
    expect(isSensitiveQueryKey("rid")).toBe(true);
    expect(isSensitiveQueryKey("ort")).toBe(false);
    expect(isSensitiveQueryKey("author_id")).toBe(false);
    expect(stripSensitiveUrlQuery("https://gavel.test/login/confirm-email?rid=abc&keep=1")).toBe(
      "https://gavel.test/login/confirm-email?keep=1",
    );
    expect(telemetryRequestPath("/login/confirm-email?rid=secret&token=abc")).toBe(
      "/login/confirm-email",
    );
    expect(telemetryRequestPath("https://gavel.test/login?token=abc")).toBe("/login");
  });

  it("erkennt bereinigte und rohe Quell-URLs als dieselbe Anzeige", () => {
    const known = indexListingSourceUrls(["https://portal.example/expose/1?keep=1", null]);
    expect(isKnownListingSourceUrl(known, "https://portal.example/expose/1?token=abc&keep=1")).toBe(
      true,
    );
    expect(isKnownListingSourceUrl(known, "https://portal.example/expose/2")).toBe(false);
    expect(isKnownListingSourceUrl(known, "https://Portal.Example/expose/1?keep=1")).toBe(true);
    expect(listingSourceUrlKey("https://Portal.Example/expose/1?token=abc&keep=1")).toBe(
      listingSourceUrlKey("https://portal.example/expose/1?keep=1"),
    );
    expect(listingSourceUrlKey("https://www.immobilienscout24.de/expose/123")).toBe(
      listingSourceUrlKey("https://immobilienscout24.de/expose/123"),
    );
    expect(
      listingSourceUrlKey("https://www.kleinanzeigen.de/s-anzeige/wohnung/123?utm_source=share"),
    ).toBe(listingSourceUrlKey("https://kleinanzeigen.de/s-anzeige/wohnung/123"));
    expect(
      stripListingIdentityQuery("https://makler.example/objekt/1?utm_campaign=mail&id=9"),
    ).toBe("https://makler.example/objekt/1?id=9");
    expect(listingSourceUrlKey("https://www.makler.example/objekt/1#galerie")).toBe(
      listingSourceUrlKey("https://makler.example/objekt/1"),
    );
    expect(stripListingIdentityQuery("https://makler.example/objekt/1?id=9#tab")).toBe(
      "https://makler.example/objekt/1?id=9",
    );
    expect(
      listingSourceUrlPrefixes(
        "https://www.kleinanzeigen.de/s-anzeige/wohnung/123?utm_source=share",
      ),
    ).toEqual(
      expect.arrayContaining([
        "https://kleinanzeigen.de/s-anzeige/wohnung/123",
        "https://www.kleinanzeigen.de/s-anzeige/wohnung/123",
      ]),
    );
    expect(listingSourceUrlLikePatterns("https://kleinanzeigen.de/s-anzeige/wohnung/123")).toEqual(
      expect.arrayContaining([
        "https://kleinanzeigen.de/s-anzeige/wohnung/123?%",
        "https://kleinanzeigen.de/s-anzeige/wohnung/123#%",
      ]),
    );
  });
});

describe("isSafeListingImageUrl", () => {
  it("erlaubt nur App-Pfade und schreibt Fremd-/MinIO-Hosts auf App-Pfade um", () => {
    expect(isSafeListingImageUrl("/zvg-images/abc/foto_0.jpg")).toBe(true);
    expect(isSafeListingImageUrl("/api/analyse/l1/cover")).toBe(true);
    expect(isSafeListingImageUrl("https://cdn.example/zvg-images/abc.jpg")).toBe(true);
    expect(isSafeListingImageUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeListingImageUrl("//evil.com/x.jpg")).toBe(false);
    expect(isSafeListingImageUrl("https://cdn.example/foto.jpg")).toBe(false);
    expect(isSafeListingImageUrl("/zvg-images/../etc/passwd")).toBe(false);
    expect(isSafeListingImageUrl("http://minio:9000/zvg-images/real-estate/1/foto_0.jpg")).toBe(
      false,
    );
    expect(publicListingImageUrl("https://cdn.example/zvg-images/abc.jpg")).toBe(
      "/zvg-images/abc.jpg",
    );
    expect(publicListingImageUrl("javascript:alert(1)")).toBeNull();
    expect(publicListingImageUrl("https://evil.com/x.jpg")).toBeNull();
    expect(publicListingImageUrl("http://minio:9000/zvg-images/berlin/haus/foto_0.jpg")).toBe(
      "/zvg-images/berlin/haus/foto_0.jpg",
    );
    expect(listingImageSrc("http://minio:9000/zvg-images/berlin/haus/foto_0.jpg")).toBe(
      "http://minio:9000/zvg-images/berlin/haus/foto_0.jpg",
    );
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://gavel.example.com");
    expect(listingImageSrc("https://gavel.example.com/zvg-images/abc/foto_0.jpg")).toBe(
      "https://gavel.example.com/zvg-images/abc/foto_0.jpg",
    );
    vi.unstubAllEnvs();
    expect(listingImageSrc("https://gavel.example.com/zvg-images/abc/foto_0.jpg")).toBe(
      "/zvg-images/abc/foto_0.jpg",
    );
    expect(listingImageSrc("https://cdn.example/zvg-images/abc.jpg")).toBe("/zvg-images/abc.jpg");
    expect(
      publicListingImageUrl("http://minio:9000/zvg-images/real-estate/1/foto_0.jpg"),
    ).toBeNull();
  });
});

describe("isSafePublicHttpsUrl", () => {
  it("spiegelt die öffentliche https-Prüfung", () => {
    expect(isSafePublicHttpsUrl("https://www.zvg-portal.de/index.php")).toBe(true);
    expect(isSafePublicHttpsUrl("http://www.zvg-portal.de/index.php")).toBe(false);
    expect(isSafePublicHttpsUrl("https://127.0.0.1/gutachten.pdf")).toBe(false);
  });
});

describe("normalizeCookieHeader", () => {
  it("entfernt den Cookie-Präfix", () => {
    expect(normalizeCookieHeader("Cookie: session=abc; theme=dark")).toBe(
      "session=abc; theme=dark",
    );
    expect(normalizeCookieHeader("session=abc")).toBe("session=abc");
  });

  it("lehnt Steuerzeichen ab", () => {
    expect(isUsableCookieHeader("session=abc")).toBe(true);
    expect(isUsableCookieHeader("session=abc\r\nHost: evil")).toBe(false);
    expect(isUsableCookieHeader("")).toBe(false);
  });

  it("lehnt Header ohne Name=Wert und mehr als 60 Paare ab", () => {
    expect(isUsableCookieHeader("keinpaar")).toBe(false);
    expect(isUsableCookieHeader("=ohne-name")).toBe(false);
    const within = Array.from({ length: 60 }, (_, i) => `n${i}=v`).join("; ");
    const overflow = `${within}; extra=1`;
    expect(isUsableCookieHeader(within)).toBe(true);
    expect(isUsableCookieHeader(overflow)).toBe(false);
    expect(isUsableCookieHeader(`${within}; junk; morejunk`)).toBe(true);
  });
});
