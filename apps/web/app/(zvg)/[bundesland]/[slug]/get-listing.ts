import { cache } from "react";
import { findZvgListingBySlug } from "@/lib/zvg-listing-lookup";
import { isUsableZvgBundesland, isUsableZvgSlug } from "@/lib/zvg-documents";

/**
 * Wird pro Request von layout.tsx, generateMetadata und der Seite gebraucht -
 * `cache` macht daraus eine einzelne Abfrage.
 */
export const getListingBySlug = cache(async function (bundesland: string, slug: string) {
  if (!isUsableZvgSlug(slug) || !isUsableZvgBundesland(bundesland)) {
    return undefined;
  }
  return findZvgListingBySlug(slug, bundesland);
});
