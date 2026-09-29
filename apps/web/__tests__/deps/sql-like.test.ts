import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_SEARCH_QUERY,
  clipSearchQuery,
  containsIlikePattern,
  escapeIlikePattern,
  plzPrefix,
} from "@/lib/sql-like";

describe("clipSearchQuery", () => {
  it("trimmt und begrenzt", () => {
    expect(clipSearchQuery("  Köln  ")).toBe("Köln");
    expect(clipSearchQuery("x".repeat(200))).toHaveLength(MAX_SEARCH_QUERY);
  });
});

describe("escapeIlikePattern", () => {
  it("escaptet LIKE-Wildcards", () => {
    expect(escapeIlikePattern("München%")).toBe("München\\%");
    expect(escapeIlikePattern("a_b")).toBe("a\\_b");
    expect(escapeIlikePattern("a\\b")).toBe("a\\\\b");
    expect(containsIlikePattern("München%")).toBe("%München\\%%");
  });
});

describe("plzPrefix", () => {
  it("nimmt nur Ziffern", () => {
    expect(plzPrefix("80331")).toBe("803");
    expect(plzPrefix("80%331")).toBe("803");
    expect(plzPrefix("12")).toBeNull();
    expect(plzPrefix(12)).toBeNull();
  });
});

describe("geo suche", () => {
  it("nutzt nur den Server-MapTiler-Key", () => {
    const src = readFileSync(path.join(__dirname, "../../app/api/geo/de/suche/route.ts"), "utf8");
    expect(src).toContain("process.env.MAPTILER_SERVER_KEY");
    expect(src).not.toContain("NEXT_PUBLIC_MAPTILER_KEY");
    expect(src).toContain("Array.isArray((json as { features: unknown }).features)");
    expect(src).toContain("results: bundeslandMatches.slice(0, 8)");
    expect(src).toContain("if (!res.ok)");
    expect(src).toContain("isUsableGeoPoint(itemLat, itemLng)");
    expect(src).not.toContain("[0, 0]");
  });

  it("lehnt Null-Island auf Detailkarten ab", () => {
    const analyse = readFileSync(
      path.join(__dirname, "../../app/analyse/[listingId]/page.tsx"),
      "utf8",
    );
    const zvg = readFileSync(
      path.join(__dirname, "../../app/(zvg)/[bundesland]/[slug]/page.tsx"),
      "utf8",
    );
    const mapLinks = readFileSync(
      path.join(__dirname, "../../components/zvg/detail/map-links.tsx"),
      "utf8",
    );
    const standort = readFileSync(
      path.join(__dirname, "../../components/zvg/detail/standort-map.tsx"),
      "utf8",
    );
    expect(analyse).toContain("parseUsableGeoPoint(listing.lat, listing.lng)");
    expect(analyse).toContain('from "@/lib/geo-point"');
    expect(zvg).toContain("parseUsableGeoPoint(listing.lat, listing.lng)");
    expect(zvg).toContain('from "@/lib/geo-point"');
    expect(mapLinks).toContain('from "@/lib/geo-point"');
    expect(standort).toContain('from "@/lib/geo-point"');
    expect(standort).not.toContain('from "@/lib/geocode"');
    const bundesland = readFileSync(
      path.join(__dirname, "../../app/(zvg)/[bundesland]/page.tsx"),
      "utf8",
    );
    const mapView = readFileSync(path.join(__dirname, "../../components/zvg/map-view.tsx"), "utf8");
    const viewToggle = readFileSync(
      path.join(__dirname, "../../components/zvg/view-toggle.tsx"),
      "utf8",
    );
    expect(bundesland).toContain("parseUsableGeoPoint(l.lat, l.lng)");
    expect(bundesland).not.toContain("l.lat && l.lng");
    expect(mapView).toContain("isUsableGeoPoint(p.lat, p.lng)");
    expect(viewToggle).toContain("isUsableGeoPoint(p.lat, p.lng)");
    expect(mapView).not.toContain("p.lat && p.lng");
    expect(viewToggle).not.toContain("p.lat && p.lng");
  });
});

describe("Listen-Fetches", () => {
  it("behandeln API-Fehler nicht als leere Treffer", () => {
    const objekte = readFileSync(
      path.join(__dirname, "../../components/zvg/alle-objekte-sheet.tsx"),
      "utf8",
    );
    expect(objekte).toContain("if (!res.ok)");
    expect(objekte).toContain("Array.isArray((data as { listings?: unknown }).listings)");
    expect(objekte).toContain("Objekte konnten nicht geladen werden.");
    const termine = readFileSync(
      path.join(__dirname, "../../components/zvg/alle-termine-sheet.tsx"),
      "utf8",
    );
    expect(termine).toContain("if (!res.ok)");
    expect(termine).toContain("Termine konnten nicht geladen werden.");
    const suggest = readFileSync(
      path.join(__dirname, "../../app/api/search-suggestions/route.ts"),
      "utf8",
    );
    expect(suggest).toContain("status: 500");
    expect(suggest).toContain("Suchvorschläge nicht verfügbar");
    expect(suggest).toContain("upcomingTerminSql()");
    const suche = readFileSync(path.join(__dirname, "../../app/suche/page.tsx"), "utf8");
    expect(suche).toContain("listingTextSearchSql(query)");
    const listingSearch = readFileSync(
      path.join(__dirname, "../../lib/listing-text-search.ts"),
      "utf8",
    );
    expect(listingSearch).toContain("ilike(zvgListings.plz, plzTerm)");
    expect(listingSearch).toContain("prefixIlikePattern(query)");
    expect(listingSearch).toContain("ilike(zvgListings.amtsgericht, term)");
    expect(listingSearch).toContain("ilike(zvgListings.bundeslandName, term)");
    expect(listingSearch).toContain("ilike(zvgListings.aktenzeichen, term)");
    const hook = readFileSync(
      path.join(__dirname, "../../hooks/use-search-suggestions.ts"),
      "utf8",
    );
    expect(hook).toContain("if (!res.ok)");
    expect(hook).toContain("Array.isArray(row.listings)");
    expect(hook).toContain("setIsError(true)");
    expect(hook).not.toContain(
      "setSuggestions(EMPTY_SUGGESTIONS);\n            setIsLoading(false);",
    );
    const neueste = readFileSync(
      path.join(__dirname, "../../components/zvg/neueste-objekte-section.tsx"),
      "utf8",
    );
    expect(neueste).toContain("if (!res.ok)");
    expect(neueste).toContain("Array.isArray((data as { listings?: unknown }).listings)");
    expect(neueste).toContain("afterCreatedAt");
    expect(neueste).toContain("setKnownTotal(payload.total)");
    expect(neueste).toContain("setLoadError(true)");
    expect(neueste).toContain("countKnown");
    expect(neueste).toContain("Bestand unvollständig.");
    expect(neueste).toContain("sinceHours");
    expect(neueste).toContain('params.set("order", "created")');
    const homepage = readFileSync(path.join(__dirname, "../../app/page.tsx"), "utf8");
    expect(homepage).toContain("totalCount={totalCount}");
    expect(homepage).toContain("sinceHours={sinceHours}");
    expect(homepage).toContain("scopedTo24h");
    expect(homepage).toContain("recent?.total ?? recentListings?.length ?? 0");
    expect(homepage).toContain("scopedTo24h: false");
    expect(homepage).toContain("desc(zvgListings.createdAt), desc(zvgListings.id)");
    expect(homepage).not.toContain("totalCount ?? serializedListings.length");
    const objekteApi = readFileSync(path.join(__dirname, "../../app/api/objekte/route.ts"), "utf8");
    expect(objekteApi).toContain("sinceHours");
    expect(objekteApi).toContain("gte(zvgListings.createdAt, since)");
    expect(objekteApi).toContain("desc(zvgListings.createdAt), desc(zvgListings.id)");
    expect(objekteApi).toContain("afterCreatedAt");
    expect(objekteApi).toContain('searchParams.get("order") === "created"');
    expect(objekteApi).toContain("listings:");
    expect(objekteApi).toContain("total:");
    expect(objekteApi).toContain("createdOrder ? Number(countRow?.total ?? 0) : null");
    expect(homepage).toContain("createdAt: l.createdAt ? l.createdAt.toISOString()");
    const bundeslandListe = readFileSync(
      path.join(__dirname, "../../app/(zvg)/[bundesland]/page.tsx"),
      "utf8",
    );
    expect(bundeslandListe).toContain(
      "neu_zuerst: [desc(zvgListings.createdAt), desc(zvgListings.id)]",
    );
    const zvgApi = readFileSync(path.join(__dirname, "../../app/api/zvg/route.ts"), "utf8");
    expect(zvgApi).toContain("neu_zuerst: [desc(zvgListings.createdAt), desc(zvgListings.id)]");
    const archivListe = readFileSync(path.join(__dirname, "../../app/archiv/page.tsx"), "utf8");
    expect(archivListe).toContain("desc(zvgListings.terminDate), desc(zvgListings.id)");
    const alertsCron = readFileSync(
      path.join(__dirname, "../../app/api/cron/check-alerts/route.ts"),
      "utf8",
    );
    expect(alertsCron).toContain("desc(zvgListings.createdAt), desc(zvgListings.id)");
    const laender = readFileSync(path.join(__dirname, "../../app/laender/page.tsx"), "utf8");
    expect(laender).toContain("return null");
    expect(laender).toContain("Daten nicht verfügbar.");
    expect(laender).not.toContain("count: 0, neu7Tage: 0");
    const favorites = readFileSync(
      path.join(__dirname, "../../hooks/use-favorites-count.ts"),
      "utf8",
    );
    expect(favorites).toContain("Array.isArray(favorites)");
    const cover = readFileSync(path.join(__dirname, "../../lib/listing-cover.ts"), "utf8");
    expect(cover).toContain("is_cover DESC");
    expect(cover).toContain("position ASC");
    for (const rel of [
      "../../app/page.tsx",
      "../../app/api/objekte/route.ts",
      "../../app/api/termine/route.ts",
      "../../app/suche/page.tsx",
      "../../app/archiv/page.tsx",
      "../../app/(zvg)/[bundesland]/page.tsx",
      "../../app/favoriten/page.tsx",
      "../../lib/investor-queries.ts",
    ]) {
      const page = readFileSync(path.join(__dirname, rel), "utf8");
      expect(page).toContain("LISTING_COVER_IMAGE_SQL");
      expect(page).not.toContain("ORDER BY position ASC NULLS LAST");
    }
    for (const rel of [
      "../../app/(zvg)/[bundesland]/[slug]/page.tsx",
      "../../app/api/zvg/[slug]/route.ts",
      "../../app/api/cron/check-alerts/route.ts",
    ]) {
      const page = readFileSync(path.join(__dirname, rel), "utf8");
      expect(page).toContain("LISTING_COVER_ORDER");
      expect(page).not.toContain("asc(img.position)");
      expect(page).not.toContain("eq(zvgImages.isCover, true)");
    }
    const ticker = readFileSync(
      path.join(__dirname, "../../components/layout/live-ticker.tsx"),
      "utf8",
    );
    expect(ticker).toContain("unavailable: true");
    expect(ticker).toContain("UNBEKANNT");
    const analyseClient = readFileSync(
      path.join(__dirname, "../../app/analyse/(uebersicht)/client.tsx"),
      "utf8",
    );
    expect(analyseClient).toContain("isValidUuid(postData.jobId)");
    const hero = readFileSync(path.join(__dirname, "../../components/zvg/hero-search.tsx"), "utf8");
    expect(hero).toContain("Suchvorschläge nicht verfügbar.");
    const profileForm = readFileSync(
      path.join(__dirname, "../../components/account/investor-profile-form.tsx"),
      "utf8",
    );
    expect(profileForm).toContain("normalizeInvestorProfile(profilePayload)");
    const feedback = readFileSync(
      path.join(__dirname, "../../components/investor/investment-feedback.tsx"),
      "utf8",
    );
    expect(feedback).toContain("response.status === 429");
    expect(feedback).not.toContain("payload.error");
    const privacy = readFileSync(path.join(__dirname, "../../lib/listing-privacy.ts"), "utf8");
    expect(privacy).toContain("lower(COALESCE");
    expect(privacy).toContain("value.trim().toLowerCase()");
  });
});
