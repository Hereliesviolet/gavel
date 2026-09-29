import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_FAVORITES_PER_USER,
  investorDomains,
  isFavoritableDomain,
  isInvestorDomain,
} from "@/lib/product-domains";

describe("product-domains", () => {
  it("grenzt Investor auf ZVG ein", () => {
    expect(isInvestorDomain("zvg")).toBe(true);
    expect(isInvestorDomain("real_estate")).toBe(false);
    expect(investorDomains()).toEqual(["zvg"]);
  });

  it("erlaubt Favoriten in beiden Domänen", () => {
    expect(isFavoritableDomain("zvg")).toBe(true);
    expect(isFavoritableDomain("real_estate")).toBe(true);
    expect(isFavoritableDomain("other")).toBe(false);
    expect(MAX_FAVORITES_PER_USER).toBe(100);
    const writeSrc = readFileSync(path.join(__dirname, "../../lib/favorite-write.ts"), "utf8");
    const accessInTx = writeSrc.indexOf("findAccessibleRealEstateListing(userId, listingId, tx)");
    expect(accessInTx).toBeGreaterThan(writeSrc.indexOf("db.transaction"));
    expect(writeSrc).toContain("quotaFavoriteCondition");
    expect(writeSrc).toContain("desc(userFavorites.createdAt), desc(userFavorites.id)");
    expect(writeSrc).toContain(
      "EXISTS (SELECT 1 FROM zvg_listings z WHERE z.id = ${userFavorites.listingId} AND z.ist_aktiv = TRUE)",
    );
    const existingBlock = writeSrc.slice(
      writeSrc.indexOf("function existingFavoriteCondition"),
      writeSrc.indexOf("function quotaFavoriteCondition"),
    );
    const quotaBlock = writeSrc.slice(writeSrc.indexOf("function quotaFavoriteCondition"));
    expect(existingBlock).toContain(
      "EXISTS (SELECT 1 FROM real_estate_listings r WHERE r.id = ${userFavorites.listingId})",
    );
    expect(existingBlock).not.toContain("r.ist_aktiv");
    expect(quotaBlock).toContain(
      'EXISTS (SELECT 1 FROM real_estate_listings r WHERE r.id = ${userFavorites.listingId} AND r.ist_aktiv = TRUE AND (r.submitted_by_user_id = ${userFavorites.userId} OR (${sql.raw(publicLiveScrapePredicate("r"))})))',
    );
    expect(writeSrc).toContain("publicLiveScrapePredicate");
    expect(writeSrc.indexOf("quotaFavoriteCondition()")).toBeGreaterThan(-1);
    expect(writeSrc.indexOf("quotaFavoriteCondition()")).toBeLessThan(
      writeSrc.indexOf("if (Number(used?.n ?? 0) >= MAX_FAVORITES_PER_USER)"),
    );
    const favoritenPage = readFileSync(
      path.join(__dirname, "../../app/favoriten/page.tsx"),
      "utf8",
    );
    const favoritesApi = readFileSync(
      path.join(__dirname, "../../app/api/favorites/route.ts"),
      "utf8",
    );
    expect(favoritenPage).toContain("listExistingUserFavorites(userId)");
    expect(favoritenPage).not.toContain("limit: MAX_FAVORITES_PER_USER");
    expect(favoritesApi).toContain("listExistingUserFavorites(session.user.id)");
    expect(favoritesApi).not.toContain("limit: MAX_FAVORITES_PER_USER");
  });
});
