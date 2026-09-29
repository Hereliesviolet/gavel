import type { SearchSuggestions } from "@/app/api/search-suggestions/route";
import { zvgListingPath } from "@/lib/zvg-documents";

export type FlatSuggestionItem =
  | { type: "ort"; key: string; label: string }
  | { type: "amtsgericht"; key: string; label: string }
  | { type: "plz"; key: string; label: string }
  | {
      type: "listing";
      key: string;
      label: string;
      sublabel: string | null;
      slug: string;
      bundesland: string;
    };

export const SUGGESTION_GROUP_LABELS: Record<FlatSuggestionItem["type"], string> = {
  ort: "Orte",
  amtsgericht: "Amtsgerichte",
  plz: "PLZ",
  listing: "Objekte",
};

export const SUGGESTION_GROUP_ORDER: FlatSuggestionItem["type"][] = [
  "ort",
  "amtsgericht",
  "plz",
  "listing",
];

export function flattenSuggestions(suggestions: SearchSuggestions): FlatSuggestionItem[] {
  return [
    ...suggestions.orte.map((ort) => ({ type: "ort" as const, key: `ort:${ort}`, label: ort })),
    ...suggestions.amtsgerichte.map((ag) => ({
      type: "amtsgericht" as const,
      key: `ag:${ag}`,
      label: ag,
    })),
    ...suggestions.plz.map((plz) => ({ type: "plz" as const, key: `plz:${plz}`, label: plz })),
    ...suggestions.listings.map((l) => ({
      type: "listing" as const,
      key: `listing:${l.slug}`,
      label: l.titel,
      sublabel: l.ort,
      slug: l.slug,
      bundesland: l.bundesland,
    })),
  ];
}

/**
 * Orte/Amtsgerichte/PLZ führen zur gefilterten Suchergebnisliste, ein Listing-Treffer
 * navigiert direkt zur Detailseite des Objekts.
 */
export function suggestionHref(item: FlatSuggestionItem): string {
  if (item.type === "listing") {
    return zvgListingPath(item.bundesland, item.slug) ?? "/suche";
  }
  return `/suche?q=${encodeURIComponent(item.label)}`;
}
