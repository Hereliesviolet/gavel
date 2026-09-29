"use client";

import { useFavoritedListingIds } from "@/hooks/use-favorited-listing-ids";
import { ListingGrid } from "@/components/zvg/listing-grid";
import type { ZvgListingCardData } from "@/components/zvg/listing-card";

export function HydratingListingGrid({ listings }: { listings: ZvgListingCardData[] }) {
  const favoritedIds = useFavoritedListingIds();
  return <ListingGrid listings={listings} favoritedIds={[...favoritedIds]} />;
}
