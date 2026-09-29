import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function src(rel: string) {
  return readFileSync(path.join(__dirname, "../..", rel), "utf8");
}

describe("Favoriten-Hydration", () => {
  it("ZVG-Detail lädt den Stern und gibt ihn an Galerie und Button", () => {
    const page = src("app/(zvg)/[bundesland]/[slug]/page.tsx");
    expect(page).toContain("db.query.userFavorites.findFirst");
    expect(page).toContain('eq(userFavorites.listingType, "zvg")');
    expect(page).toContain("initialFavorited={isFavorited}");
    expect(page).not.toMatch(/<FavoriteButton listingId=\{listing\.id\} \/>/);
    expect(page).not.toMatch(
      /<GalleryHero images=\{imageUrls\} listingId=\{listing\.id\} className="mb-3" \/>/,
    );
  });

  it("Suche und Bundesland-Grid übergeben sichtbare Favoriten vom Server", () => {
    const suche = src("app/suche/page.tsx");
    const land = src("app/(zvg)/[bundesland]/page.tsx");
    const write = src("lib/favorite-write.ts");
    expect(write).toContain("export async function favoritedListingIds");
    expect(write).toContain("inArray(userFavorites.listingId, listingIds)");
    expect(suche).toContain("favoritedListingIds(");
    expect(suche).toContain("favoritedIds={favoritedIds}");
    expect(land).toContain("favoritedListingIds(");
    expect(land).toContain("favoritedIds={favoritedIds}");
  });

  it("Homepage und Archiv hydratisieren clientseitig und bleiben unpersonalisiert im Cache", () => {
    const home = src("app/page.tsx");
    const archiv = src("app/archiv/page.tsx");
    const neueste = src("components/zvg/neueste-objekte-section.tsx");
    const hydrate = src("components/zvg/hydrating-listing-grid.tsx");
    expect(home).toContain("export const revalidate = 60");
    expect(home).not.toContain("favoritedListingIds");
    expect(home).not.toContain('from "@/lib/auth"');
    expect(archiv).toContain("export const revalidate = 3600");
    expect(archiv).toContain("HydratingListingGrid");
    expect(archiv).not.toContain("favoritedListingIds");
    expect(archiv).not.toContain('from "@/lib/auth"');
    expect(neueste).toContain("useFavoritedListingIds()");
    expect(neueste).toContain("isFavorited={favoritedIds.has(listing.id)}");
    expect(hydrate).toContain("useFavoritedListingIds()");
    expect(hydrate).toContain("favoritedIds={[...favoritedIds]}");
  });

  it("Heute-Aufmacher hydratisiert den Stern aus der Session", () => {
    const heute = src("app/investor/page.tsx");
    const featured = src("components/investor/investor-featured-deal.tsx");
    expect(heute).toContain("favoritedListingIds(session.user.id, [aufmacher.listingId])");
    expect(heute).toContain("initialFavorited={featuredFavorited}");
    expect(featured).toContain("initialFavorited={initialFavorited}");
    expect(featured).toContain(
      "verkehrswert=${pick.metrics.verkehrswert}&versteigerungswert=${pick.metrics.referenceBidEur ?? pick.metrics.verkehrswert}",
    );
    expect(featured).not.toContain("/rechner?preis=");
    const rechner = src("app/rechner/page.tsx");
    expect(rechner).toContain("parseEuroSearchParam");
    expect(rechner).toContain('["verkehrswert", "kaufpreis", "preis"]');
    expect(rechner).toContain("vsExplicit ?? vwExplicit ?? 200000");
    expect(rechner).toContain("[vwFromUrl, vsFromUrl, blFromUrl]");
    expect(rechner).toContain('findBundesland(sp.get("bundesland"))?.slug');
    expect(featured).toContain("findBundesland(pick.bundesland)?.slug");
    expect(rechner).not.toContain("parseInt(sp.get(");
  });

  it("FavoriteButton setzt den State bei Listing-Wechsel zurück", () => {
    const button = src("components/shared/favorite-button.tsx");
    expect(button).toContain("`${listingType}:${listingId}`");
    expect(button).toContain("[identity, initialFavorited]");
    expect(button).toContain("identityRef.current");
    expect(button).toContain("if (identityRef.current === requestIdentity)");
    expect(button).toContain("onFavoritedChange?.(newState)");
  });

  it("Favoriten-Seite entfernt die Karte nach erfolgreichem Unfavorite", () => {
    const client = src("app/favoriten/client.tsx");
    expect(client).toContain("useState(initialFavorites)");
    expect(client).toContain("favoriteIdentityKey");
    expect(client).toContain("syncedKeyRef");
    expect(client).toContain("onFavoritedChange");
    expect(client).toContain("setFavorites((prev) =>");
    expect(client).toContain("router.refresh()");
    expect(client).toContain("favorites.length");
    expect(client).not.toContain("initialFavorites.length");
    expect(client).not.toContain("initialFavorites.reduce");
    expect(client).not.toContain("initialFavorites.filter");
    expect(client).not.toMatch(
      /useEffect\(\(\) => \{\s*setFavorites\(initialFavorites\);\s*\}, \[initialFavorites\]\)/,
    );
  });
});
