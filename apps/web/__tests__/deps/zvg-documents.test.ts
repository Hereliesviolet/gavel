import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  candidateZvgDocumentKeys,
  extractStoredZvgDocumentKey,
  isAllowedExternalZvgDocumentUrl,
  isDirectlinkUsable,
  isPublicZvgSourceUrl,
  isGavelStorageUrl,
  isUsableZvgBundesland,
  isUsableZvgSlug,
  publicZvgDocumentHref,
  zvgListingPath,
  zvgBundeslandFromRequest,
  zvgDocumentApiPath,
  zvgPdfDownloadName,
} from "@/lib/zvg-documents";

const listing = {
  id: "11111111-1111-1111-1111-111111111111",
  bundesland: "bayern",
  slug: "haus-muenchen",
};

describe("zvg documents", () => {
  it("begrenzt Slugs", () => {
    expect(isUsableZvgSlug("haus-muenchen")).toBe(true);
    expect(isUsableZvgSlug("")).toBe(false);
    expect(isUsableZvgSlug("x".repeat(201))).toBe(false);
    expect(isUsableZvgSlug('foo"; filename=evil')).toBe(false);
    expect(isUsableZvgSlug("haus\r\nmuenchen")).toBe(false);
    expect(isUsableZvgSlug("../etc")).toBe(false);
  });

  it("baut einen sicheren PDF-Dateinamen", () => {
    expect(zvgPdfDownloadName("gutachten", "haus-muenchen")).toBe("gutachten-haus-muenchen.pdf");
    expect(zvgPdfDownloadName("expose", 'foo";\r\nfilename=x')).toBe("expose-foofilenamex.pdf");
  });

  it("erkennt interne Speicher-URLs", () => {
    expect(isGavelStorageUrl("http://minio:9000/zvg-images/abc/gutachten.pdf")).toBe(true);
    expect(isGavelStorageUrl("/zvg-images/abc/expose.pdf")).toBe(true);
    expect(isGavelStorageUrl("https://www.zvg-portal.de/index.php?button=showAnhang")).toBe(false);
  });

  it("leitet App-Pfade nur für gespeicherte PDFs ab", () => {
    expect(
      publicZvgDocumentHref(
        "http://localhost:9000/zvg-images/abc/gutachten.pdf",
        listing.slug,
        "gutachten",
      ),
    ).toBe("/api/zvg/haus-muenchen/gutachten");
    expect(
      publicZvgDocumentHref(
        "http://localhost:9000/zvg-images/abc/gutachten.pdf",
        listing.slug,
        "gutachten",
        listing.bundesland,
      ),
    ).toBe("/api/zvg/haus-muenchen/gutachten?bundesland=bayern");
    expect(zvgDocumentApiPath("haus-muenchen", "expose", "bayern")).toBe(
      "/api/zvg/haus-muenchen/expose?bundesland=bayern",
    );
    expect(isUsableZvgBundesland("nordrhein-westfalen")).toBe(true);
    expect(isUsableZvgBundesland("../etc")).toBe(false);
    expect(isUsableZvgBundesland("evil.com")).toBe(false);
    expect(isUsableZvgBundesland("")).toBe(false);
    expect(zvgListingPath("bayern", "haus-muenchen")).toBe("/bayern/haus-muenchen");
    expect(zvgListingPath("NRW", "haus-koeln")).toBe("/nordrhein-westfalen/haus-koeln");
    expect(zvgListingPath("baden-wuerttemberg", "haus")).toBe("/badenwuerttemberg/haus");
    expect(zvgListingPath("", "haus-muenchen")).toBeNull();
    expect(zvgListingPath("bayern", "//evil.com")).toBeNull();
    expect(zvgListingPath("evil.com", "haus-muenchen")).toBeNull();
    expect(zvgBundeslandFromRequest("  bayern  ")).toBe("bayern");
    expect(zvgBundeslandFromRequest("")).toBeUndefined();
    expect(
      publicZvgDocumentHref(
        "https://www.zvg-portal.de/index.php?button=showAnhang",
        listing.slug,
        "gutachten",
      ),
    ).toBe("https://www.zvg-portal.de/index.php?button=showAnhang");
    expect(publicZvgDocumentHref("javascript:alert(1)", listing.slug, "gutachten")).toBeNull();
    expect(
      publicZvgDocumentHref("https://evil.example/gutachten.pdf", listing.slug, "gutachten"),
    ).toBeNull();
    expect(
      publicZvgDocumentHref(
        "http://www.zvg-portal.de/index.php?button=showAnhang",
        listing.slug,
        "gutachten",
      ),
    ).toBeNull();
  });

  it("akzeptiert nur Schlüssel zum eigenen Listing", () => {
    expect(
      extractStoredZvgDocumentKey(
        `http://minio:9000/zvg-images/${listing.id}/gutachten.pdf`,
        listing,
        "gutachten",
      ),
    ).toBe(`${listing.id}/gutachten.pdf`);
    expect(
      extractStoredZvgDocumentKey(
        "http://minio:9000/zvg-images/bayern/haus-muenchen/expose.pdf",
        listing,
        "expose",
      ),
    ).toBe("bayern/haus-muenchen/expose.pdf");
    expect(
      extractStoredZvgDocumentKey(
        "http://minio:9000/zvg-images/bayern/haus-alt-ort/gutachten.pdf",
        listing,
        "gutachten",
      ),
    ).toBeNull();
    expect(
      extractStoredZvgDocumentKey(
        "http://minio:9000/zvg-images/other/gutachten.pdf",
        listing,
        "gutachten",
      ),
    ).toBeNull();
    expect(
      extractStoredZvgDocumentKey(
        "http://minio:9000/zvg-images/hamburg/haus-alt-ort/gutachten.pdf",
        listing,
        "gutachten",
      ),
    ).toBeNull();
    expect(
      extractStoredZvgDocumentKey(
        "http://minio:9000/zvg-images/bayern/../etc/gutachten.pdf",
        listing,
        "gutachten",
      ),
    ).toBeNull();
    const docs = readFileSync(path.join(__dirname, "../../lib/zvg-documents.ts"), "utf8");
    expect(docs).toContain("parts[1] === listing.slug");
  });

  it("erlaubt nur bekannte Amtsgerichts-Hosts für externe PDFs", () => {
    expect(
      isAllowedExternalZvgDocumentUrl("https://www.zvg-portal.de/index.php?button=showAnhang"),
    ).toBe(true);
    expect(
      isAllowedExternalZvgDocumentUrl("https://zvg-portal.de/index.php?button=showAnhang"),
    ).toBe(true);
    expect(isAllowedExternalZvgDocumentUrl("https://www.zvg.com/gutachten.pdf")).toBe(true);
    expect(isAllowedExternalZvgDocumentUrl("https://zvg.com/gutachten.pdf")).toBe(true);
    expect(isAllowedExternalZvgDocumentUrl("https://www.hanmark.de/gutachten.pdf")).toBe(true);
    expect(isAllowedExternalZvgDocumentUrl("https://evil.example/gutachten.pdf")).toBe(false);
    expect(isAllowedExternalZvgDocumentUrl("https://evil.zvg-portal.de/gutachten.pdf")).toBe(false);
    expect(isAllowedExternalZvgDocumentUrl("https://cdn.zvg.com/gutachten.pdf")).toBe(false);
  });

  it("lässt Direktlinks nur auf https und Allowlist-Hosts zu", () => {
    expect(isPublicZvgSourceUrl("https://zvg.com/objekt/1/show")).toBe(true);
    expect(isPublicZvgSourceUrl("http://zvg.com/objekt/1/show")).toBe(false);
    expect(isPublicZvgSourceUrl("javascript:alert(1)")).toBe(false);
    expect(isPublicZvgSourceUrl("https://evil.example/phish")).toBe(false);
    expect(isDirectlinkUsable("https://zvg.com/objekt/1/show", "zvg.com")).toBe(true);
    expect(isDirectlinkUsable("https://evil.example/phish", "zvg.com")).toBe(false);
    expect(isDirectlinkUsable("javascript:alert(1)", "hanmark.de")).toBe(false);
    expect(
      isDirectlinkUsable(
        "https://www.zvg-portal.de/index.php?button=showZvg&zvg_id=1&land_abk=be",
        "justizportal",
      ),
    ).toBe(false);
    expect(
      isDirectlinkUsable(
        "https://www.zvg-portal.de/index.php?button=showZvg&zvg_id=1&land_abk=be",
        "zvg.com",
      ),
    ).toBe(true);
    expect(
      isDirectlinkUsable("https://www.zvg-portal.de/index.php?button=showZvg&zvg_id=1", "zvg.com"),
    ).toBe(false);
    const detail = readFileSync(
      path.join(__dirname, "../../app/(zvg)/[bundesland]/[slug]/page.tsx"),
      "utf8",
    );
    expect(detail).not.toContain("gutachtenHref ?? listing.gutachtenUrl");
    expect(detail).toContain("href={gutachtenHref}");
  });

  it("liefert die bekannten Speicherpfade", () => {
    expect(candidateZvgDocumentKeys(listing, "gutachten")).toEqual([
      `${listing.id}/gutachten.pdf`,
      "bayern/haus-muenchen/gutachten.pdf",
    ]);
  });

  it("sucht gespeicherte PDFs auch nach überschriebener Portal-URL", () => {
    const stream = readFileSync(path.join(__dirname, "../../lib/zvg-document-stream.ts"), "utf8");
    expect(stream).toContain("...candidateZvgDocumentKeys(listing, kind)");
    expect(stream).toContain("isAllowedExternalZvgDocumentUrl(url)");
    expect(stream.indexOf("candidateZvgDocumentKeys")).toBeLessThan(
      stream.indexOf("isAllowedExternalZvgDocumentUrl"),
    );
    expect(stream).not.toContain("if (!url) {");
  });

  it("erzwingt eine Position je ZVG-Listing", () => {
    const schema = readFileSync(path.join(__dirname, "../../drizzle/schema/zvg.ts"), "utf8");
    const migration = readFileSync(
      path.join(__dirname, "../../drizzle/migrations/0036_zvg_images_listing_position_unique.sql"),
      "utf8",
    );
    expect(schema).toContain('uniqueIndex("zvg_images_listing_position_uidx")');
    expect(migration).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS zvg_images_listing_position_uidx",
    );
    expect(migration).toContain("DELETE FROM zvg_images a");
  });

  it("setzt ist_neu anhand von created_at zurück", () => {
    const migration = readFileSync(
      path.join(__dirname, "../../drizzle/migrations/0037_zvg_ist_neu_created_at.sql"),
      "utf8",
    );
    const journal = readFileSync(
      path.join(__dirname, "../../drizzle/migrations/meta/_journal.json"),
      "utf8",
    );
    expect(migration).toContain(
      "SET ist_neu = COALESCE(created_at >= (NOW() - INTERVAL '24 hours'), FALSE)",
    );
    expect(journal).toContain("0037_zvg_ist_neu_created_at");
  });

  it("räumt Justizportal-Suchseiten aus direktlink", () => {
    const migration = readFileSync(
      path.join(__dirname, "../../drizzle/migrations/0038_clear_portal_search_direktlink.sql"),
      "utf8",
    );
    const journal = readFileSync(
      path.join(__dirname, "../../drizzle/migrations/meta/_journal.json"),
      "utf8",
    );
    expect(migration).toContain("button=Termine+suchen");
    expect(migration).toContain("direktlink NOT LIKE '%button=showZvg%'");
    expect(journal).toContain("0038_clear_portal_search_direktlink");
  });
});
