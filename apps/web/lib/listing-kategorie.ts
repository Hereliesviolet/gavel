import { isListingKategorie, type ListingKategorie } from "@/lib/kategorien";

export const WOHNUNG_TOKENS = ["wohnung", "appartement", "eigentumswohnung", "apartment"] as const;
export const HAUS_TOKENS = [
  "haus",
  "villa",
  "reihen",
  "doppel",
  "einfamilien",
  "mehrfamilien",
  "anwesen",
  "resthof",
  "ruine",
] as const;
export const GRUNDSTUECK_TOKENS = [
  "grundstück",
  "grundstueck",
  "flurstück",
  "landwirtsch",
  "erbbau",
  "land-/forst",
  "forstwirtschaft",
  "forst",
  "gestüt",
] as const;
export const GEWERBE_FIRST_TOKENS = [
  "geschäftshaus",
  "geschaeftshaus",
  "wohn-/geschäft",
  "wohn-/geschaeft",
  "wohn-/gewerbe",
  "einkaufspassage",
  "einkaufszentrum",
] as const;
export const GEWERBE_TOKENS = [
  "gewerbe",
  "büro",
  "laden",
  "fabrik",
  "werkstatt",
  "lager",
  "gewerblich",
] as const;

export function inferListingKategorie(typ: string | null | undefined): ListingKategorie | null {
  if (!typ) return null;
  const t = typ.toLowerCase();
  if (WOHNUNG_TOKENS.some((token) => t.includes(token))) return "wohnung";
  if (GEWERBE_FIRST_TOKENS.some((token) => t.includes(token))) return "gewerbe";
  if (HAUS_TOKENS.some((token) => t.includes(token))) return "haus";
  if (GRUNDSTUECK_TOKENS.some((token) => t.includes(token))) return "grundstueck";
  if (GEWERBE_TOKENS.some((token) => t.includes(token))) return "gewerbe";
  return null;
}

export function listingKategorieFuerPeer(
  kategorie: string | null | undefined,
  typ: string | null | undefined,
): ListingKategorie | null {
  const stored = kategorie?.trim().toLowerCase();
  if (stored && isListingKategorie(stored)) return stored;
  return inferListingKategorie(typ);
}

const KATEGORIE_LABEL: Record<ListingKategorie, string> = {
  wohnung: "Wohnung",
  haus: "Haus",
  grundstueck: "Grundstück",
  gewerbe: "Gewerbe",
};

export function listingKategorieLabel(
  kategorie: string | null | undefined,
  typ: string | null | undefined,
): string {
  const resolved = listingKategorieFuerPeer(kategorie, typ);
  if (resolved) return KATEGORIE_LABEL[resolved];
  return typ?.trim() || "Objekt";
}
