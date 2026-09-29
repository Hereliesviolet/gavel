import { normalizeBundeslandSlug } from "@/lib/bundesland";
import { listingMatchesWantedTypes } from "@/lib/listing-type-filter";

export type InvestorProfileMatchListing = {
  bundesland?: string | null;
  kategorie?: string | null;
  typ?: string | null;
};

export type InvestorProfileMatchInput = {
  regions?: string[] | null;
  propertyTypes?: string[] | null;
};

export const DESK_PICK_STRATEGIES = ["fix_flip", "buy_hold", "unter_markt"] as const;
export type DeskPickStrategy = (typeof DESK_PICK_STRATEGIES)[number];

export function isDeskPickStrategy(value: string | null | undefined): value is DeskPickStrategy {
  return value === "fix_flip" || value === "buy_hold" || value === "unter_markt";
}

export function selectDeskPickStrategy(
  scoreOf: (strategy: DeskPickStrategy) => number,
  preferred?: string | null,
): DeskPickStrategy {
  if (isDeskPickStrategy(preferred)) return preferred;
  return DESK_PICK_STRATEGIES.reduce((best, candidate) =>
    scoreOf(candidate) > scoreOf(best) ? candidate : best,
  );
}

export function listingMatchesInvestorRegions(
  listingBundesland: string | null | undefined,
  regions: string[] | null | undefined,
): boolean {
  if (!regions?.length) return true;
  const listingSlug = normalizeBundeslandSlug(listingBundesland);
  if (!listingSlug) return false;
  return regions.some((region) => normalizeBundeslandSlug(region) === listingSlug);
}

export function listingMatchesInvestorPropertyTypes(
  listing: Pick<InvestorProfileMatchListing, "kategorie" | "typ">,
  propertyTypes: string[] | null | undefined,
): boolean {
  if (!propertyTypes?.length) return true;
  return listingMatchesWantedTypes(listing, propertyTypes);
}

export function matchesInvestorProfile(
  row: { listing: InvestorProfileMatchListing },
  profileInput?: InvestorProfileMatchInput | null,
): boolean {
  if (!profileInput) return true;
  return (
    listingMatchesInvestorRegions(row.listing.bundesland, profileInput.regions) &&
    listingMatchesInvestorPropertyTypes(row.listing, profileInput.propertyTypes)
  );
}

export type FinderRegionLock =
  { kind: "unrestricted" } | { kind: "slugs"; slugs: string[] } | { kind: "none" };

export function intersectFinderBundeslaender(
  requested: string[] | undefined,
  profileRegions: string[] | undefined,
): FinderRegionLock {
  const unique = (values: string[] | undefined) => [
    ...new Set((values ?? []).map((value) => normalizeBundeslandSlug(value)).filter(Boolean)),
  ];
  const profile = unique(profileRegions);
  const asked = unique(requested);
  if (profile.length === 0 && asked.length === 0) return { kind: "unrestricted" };
  if (profile.length === 0) return { kind: "slugs", slugs: asked };
  if (asked.length === 0) return { kind: "slugs", slugs: profile };
  const slugs = asked.filter((slug) => profile.includes(slug));
  return slugs.length === 0 ? { kind: "none" } : { kind: "slugs", slugs };
}
