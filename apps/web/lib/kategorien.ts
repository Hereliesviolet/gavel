export const LISTING_KATEGORIEN = ["wohnung", "haus", "grundstueck", "gewerbe"] as const;
export type ListingKategorie = (typeof LISTING_KATEGORIEN)[number];

export function isListingKategorie(raw: unknown): raw is ListingKategorie {
  return typeof raw === "string" && (LISTING_KATEGORIEN as readonly string[]).includes(raw);
}

export function parseListingKategorien(raw: string[]): ListingKategorie[] {
  return raw.filter(isListingKategorie);
}
