import { describe, expect, it } from "vitest";
import {
  PUBLIC_LIVE_SCRAPE_PREDICATE,
  publicLiveScrapePredicate,
  canReadCustomListing,
  isPrivateCustomListing,
  listingBeschreibungFromRaw,
} from "@/lib/listing-privacy";
import {
  omitKiInternals,
  omitListingInternals,
  omitPurchaseUnderwriting,
  omitZvgImageInternals,
} from "@/lib/listing-public";
import {
  customListingCoverSrc,
  customListingImageSrc,
  listingImageNeedsBrowserCookies,
} from "@/lib/analyse-images";

describe("isPrivateCustomListing", () => {
  it("erkennt Cookie-Sessions und manuelle Quellen", () => {
    expect(isPrivateCustomListing(null)).toBe(true);
    expect(isPrivateCustomListing({ beschreibung: "öffentlich" })).toBe(true);
    expect(isPrivateCustomListing({ scrape_metadata: { fetch_source: "scrapling" } })).toBe(false);
    expect(isPrivateCustomListing({ scrape_metadata: { session_cookie_used: true } })).toBe(true);
    expect(isPrivateCustomListing({ scrape_metadata: { session_cookie_used: "true" } })).toBe(true);
    expect(isPrivateCustomListing({ scrape_metadata: { session_cookie_used: 1 } })).toBe(true);
    expect(
      isPrivateCustomListing({
        scrape_metadata: { fetch_source: "scrapling", session_cookie_used: "TRUE" },
      }),
    ).toBe(true);
    expect(isPrivateCustomListing({ scrape_metadata: { fetch_source: "manual_html" } })).toBe(true);
    expect(isPrivateCustomListing({ scrape_metadata: { fetch_source: "manual_pdf" } })).toBe(true);
    expect(isPrivateCustomListing({ scrape_metadata: { fetch_source: "unknown" } })).toBe(true);
    expect(isPrivateCustomListing({ scrape_metadata: {} })).toBe(true);
    expect(
      isPrivateCustomListing(
        { scrape_metadata: { fetch_source: "scrapling" } },
        "https://manuelle-eingabe.immopulse/html/abc",
      ),
    ).toBe(true);
  });

  it("spiegelt die Privacy-Regel in der Kandidaten-SQL", () => {
    expect(PUBLIC_LIVE_SCRAPE_PREDICATE).toContain("session_cookie_used");
    expect(PUBLIC_LIVE_SCRAPE_PREDICATE).toContain("scrapling");
    expect(PUBLIC_LIVE_SCRAPE_PREDICATE).toContain("http");
    expect(PUBLIC_LIVE_SCRAPE_PREDICATE).toContain("lower(COALESCE");
    expect(PUBLIC_LIVE_SCRAPE_PREDICATE).toContain("manuelle-eingabe.immopulse");
    expect(PUBLIC_LIVE_SCRAPE_PREDICATE).toContain("source_url");
    expect(publicLiveScrapePredicate("r")).toContain('r."raw_data"');
    expect(publicLiveScrapePredicate("r")).toContain('r."source_url"');
  });
});

describe("listingBeschreibungFromRaw", () => {
  it("liest nur den Beschreibungstext", () => {
    expect(listingBeschreibungFromRaw({ beschreibung: "  Hell und ruhig  " })).toBe(
      "  Hell und ruhig  ",
    );
    expect(
      listingBeschreibungFromRaw({ scrape_metadata: { session_cookie_used: true } }),
    ).toBeNull();
    expect(listingBeschreibungFromRaw(null)).toBeNull();
  });
});

describe("canReadCustomListing", () => {
  it("erlaubt dem Einreicher private Listings, anderen nur öffentliche", () => {
    const owner = "user-a";
    const privateListing = {
      submittedByUserId: owner,
      rawData: { scrape_metadata: { session_cookie_used: true } },
    };
    expect(canReadCustomListing(privateListing, owner)).toBe(true);
    expect(canReadCustomListing(privateListing, "user-b")).toBe(false);
    expect(
      canReadCustomListing(
        { submittedByUserId: owner, rawData: { scrape_metadata: { fetch_source: "scrapling" } } },
        "user-b",
      ),
    ).toBe(true);
    expect(canReadCustomListing({ submittedByUserId: owner, rawData: {} }, "user-b")).toBe(false);
    expect(
      canReadCustomListing(
        {
          submittedByUserId: owner,
          rawData: { scrape_metadata: { fetch_source: "scrapling" } },
          sourceUrl: "https://manuelle-eingabe.immopulse/pdf/abc",
        },
        "user-b",
      ),
    ).toBe(false);
  });
});

describe("analyse image paths", () => {
  it("bleiben app-intern und listen-gebunden", () => {
    expect(customListingImageSrc("l1", "i1")).toBe("/api/analyse/l1/images/i1");
    expect(customListingCoverSrc("l1")).toBe("/api/analyse/l1/cover");
    expect(listingImageNeedsBrowserCookies("/api/analyse/l1/images/i1")).toBe(true);
    expect(listingImageNeedsBrowserCookies("/api/analyse/l1/cover")).toBe(true);
    expect(listingImageNeedsBrowserCookies("/zvg-images/berlin/foto_0.jpg")).toBe(false);
  });
});

describe("omit internals", () => {
  it("entfernt rawData, QA-Felder und KI-Interna", () => {
    expect(
      omitListingInternals({
        id: "1",
        rawData: { secret: true },
        dataQualityFlags: [{ field: "preis" }],
        needsReview: true,
        scrapeCompletedAt: "2026-01-01",
        scrapedAt: "2026-01-01",
        submittedByUserId: "user-a",
        externalId: "https://portal.example/expose/1#owner:user-a",
        sourceUrl: "https://portal.example/expose/1?token=abc&keep=1",
        direktlink: "https://www.zvg-portal.de/index.php?button=showZvg&zvg_id=1&token=abc",
      }),
    ).toEqual({
      id: "1",
      sourceUrl: "https://portal.example/expose/1?keep=1",
      direktlink: "https://www.zvg-portal.de/index.php?button=showZvg&zvg_id=1",
    });
    expect(
      omitKiInternals({ score: 2, modelUsed: "x", tokensUsed: 9, fullRequestedBy: "u1" }),
    ).toEqual({ score: 2 });
    expect(
      omitPurchaseUnderwriting(
        {
          investmentScore: "attraktiv",
          renditeGeschaetztPct: "8",
          risikenInvestor: ["Lage"],
          fixFlipMassnahmen: [{ beschreibung: "Bad" }],
          arvMinEur: 200000,
          zusammenfassung: "ok",
        },
        "miete",
      ),
    ).toEqual({
      investmentScore: null,
      renditeGeschaetztPct: null,
      risikenInvestor: [],
      fixFlipMassnahmen: [],
      arvMinEur: null,
      zusammenfassung: "ok",
      investmentScoreBegruendung: null,
      cashflowEinschaetzung: null,
      fixFlipWerteinschaetzung: null,
      fixFlipGesamtkostenMinEur: null,
      fixFlipGesamtkostenMaxEur: null,
      jahresrohertrag: null,
      liegenschaftszinssatz: null,
      ertragswert: null,
      arvMaxEur: null,
      arvBegruendung: null,
      arvKonfidenz: null,
      holdingMonate: null,
    });
    expect(
      omitPurchaseUnderwriting({ investmentScore: "attraktiv", arvMinEur: 1 }, "kauf"),
    ).toEqual({ investmentScore: "attraktiv", arvMinEur: 1 });
    expect(
      omitListingInternals({
        id: "2",
        sourceUrl: "javascript:alert(1)",
        direktlink: "https://evil.example/phish",
      }),
    ).toEqual({
      id: "2",
      sourceUrl: null,
      direktlink: null,
    });
  });

  it("entfernt MinIO-Cover und schreibt Gutachten-URLs auf App-Pfade um", () => {
    expect(
      omitListingInternals({
        id: "1",
        slug: "haus-berlin",
        coverImageUrl: "http://minio:9000/zvg-images/real-estate/1/foto_0.jpg",
        gutachtenUrl: "http://minio:9000/zvg-images/abc/gutachten.pdf",
        exposeUrl: "https://www.zvg-portal.de/index.php?button=showAnhang",
      }),
    ).toEqual({
      id: "1",
      slug: "haus-berlin",
      coverImageUrl: null,
      gutachtenUrl: "/api/zvg/haus-berlin/gutachten",
      exposeUrl: "https://www.zvg-portal.de/index.php?button=showAnhang",
    });
    expect(
      omitListingInternals({
        id: "3",
        slug: "haus-berlin",
        coverImageUrl: "javascript:alert(1)",
      }),
    ).toEqual({
      id: "3",
      slug: "haus-berlin",
      coverImageUrl: null,
    });
    expect(
      omitListingInternals({
        id: "4",
        slug: "haus-berlin",
        coverImageUrl: "https://evil.example/phish.jpg",
      }),
    ).toEqual({
      id: "4",
      slug: "haus-berlin",
      coverImageUrl: null,
    });
    expect(
      omitListingInternals({
        id: "5",
        slug: "haus-berlin",
        coverImageUrl: "http://minio:9000/zvg-images/berlin/haus/foto_0.jpg",
      }),
    ).toEqual({
      id: "5",
      slug: "haus-berlin",
      coverImageUrl: "/zvg-images/berlin/haus/foto_0.jpg",
    });
    expect(
      omitListingInternals({
        id: "1",
        slug: "haus-berlin",
        gutachtenUrl: "javascript:alert(1)",
        exposeUrl: "https://evil.example/malware.pdf",
      }),
    ).toEqual({
      id: "1",
      slug: "haus-berlin",
      gutachtenUrl: null,
      exposeUrl: null,
    });
    expect(
      omitListingInternals({
        id: "1",
        slug: "haus-berlin",
        bundesland: "berlin",
        gutachtenUrl: "http://minio:9000/zvg-images/abc/gutachten.pdf",
      }),
    ).toEqual({
      id: "1",
      slug: "haus-berlin",
      bundesland: "berlin",
      gutachtenUrl: "/api/zvg/haus-berlin/gutachten?bundesland=berlin",
    });
  });

  it("lässt bei ZVG-Bildern nur öffentliche Felder", () => {
    expect(
      omitZvgImageInternals({
        id: "img-1",
        listingId: "listing-1",
        storagePath: "abc/foto_0.jpg",
        publicUrl: "/zvg-images/abc/foto_0.jpg",
        position: 0,
        isCover: true,
        width: 800,
        height: 600,
        createdAt: "2026-01-01",
      }),
    ).toEqual({
      id: "img-1",
      publicUrl: "/zvg-images/abc/foto_0.jpg",
      position: 0,
      isCover: true,
      width: 800,
      height: 600,
    });
    expect(
      omitZvgImageInternals({
        id: "img-2",
        publicUrl: "javascript:alert(1)",
      }),
    ).toEqual({
      id: "img-2",
      publicUrl: null,
      position: null,
      isCover: null,
      width: null,
      height: null,
    });
    expect(
      omitZvgImageInternals({
        id: "img-3",
        publicUrl: "https://cdn.example/zvg-images/abc/foto_0.jpg",
      }),
    ).toEqual({
      id: "img-3",
      publicUrl: "/zvg-images/abc/foto_0.jpg",
      position: null,
      isCover: null,
      width: null,
      height: null,
    });
  });
});
