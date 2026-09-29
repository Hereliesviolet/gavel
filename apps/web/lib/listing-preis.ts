import { listingKategorieFuerPeer } from "@/lib/listing-kategorie";
import type { ListingKategorie } from "@/lib/kategorien";

export const EUR_PRO_M2_RANGES: Record<ListingKategorie, readonly [number, number]> = {
  wohnung: [200, 15_000],
  haus: [150, 12_000],
  gewerbe: [30, 12_000],
  grundstueck: [1, 3_000],
};

export type ListingPreisFlaeche = {
  kategorie?: string | null;
  typ?: string | null;
  wohnflaecheM2?: string | number | null;
  nutzflaecheM2?: string | number | null;
  gesamtflaecheM2?: string | number | null;
  grundstuecksflaecheM2?: string | number | null;
};

function asPositive(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function listingFlaecheFuerPreis(
  listing: ListingPreisFlaeche,
): { m2: number; quelle: "wohn" | "nutz" | "grund" } | null {
  const kat = listingKategorieFuerPeer(listing.kategorie, listing.typ);
  const wohn = asPositive(listing.wohnflaecheM2);
  const nutz = asPositive(listing.nutzflaecheM2) ?? asPositive(listing.gesamtflaecheM2);
  const grund = asPositive(listing.grundstuecksflaecheM2);
  if (kat === "grundstueck" && grund) return { m2: grund, quelle: "grund" };
  if (kat === "gewerbe" && nutz) return { m2: nutz, quelle: "nutz" };
  if (wohn) return { m2: wohn, quelle: "wohn" };
  if (nutz) return { m2: nutz, quelle: "nutz" };
  return null;
}

export function listingPreisProM2(
  verkehrswert: number | string | null | undefined,
  listing: ListingPreisFlaeche,
): number | null {
  const vw = asPositive(verkehrswert);
  const flaeche = listingFlaecheFuerPreis(listing);
  if (vw == null || flaeche == null) return null;
  const eurM2 = vw / flaeche.m2;
  const kat = listingKategorieFuerPeer(listing.kategorie, listing.typ) ?? "haus";
  const [lo, hi] = EUR_PRO_M2_RANGES[kat];
  if (eurM2 < lo || eurM2 > hi) return null;
  return eurM2;
}
