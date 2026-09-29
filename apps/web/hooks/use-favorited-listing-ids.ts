"use client";

import { useQuery } from "@tanstack/react-query";

export const FAVORITES_LIST_QUERY_KEY = ["favorites-list"] as const;

function zvgFavoriteIds(data: unknown): Set<string> {
  const favorites =
    data && typeof data === "object" && "favorites" in data
      ? (data as { favorites: unknown }).favorites
      : null;
  const ids = new Set<string>();
  if (!Array.isArray(favorites)) return ids;
  for (const item of favorites) {
    if (!item || typeof item !== "object") continue;
    const listingId = "listingId" in item ? item.listingId : null;
    const listingType = "listingType" in item ? item.listingType : "zvg";
    if (typeof listingId === "string" && listingType === "zvg") {
      ids.add(listingId);
    }
  }
  return ids;
}

async function fetchZvgFavoriteIds(): Promise<Set<string>> {
  const res = await fetch("/api/favorites");
  if (res.status === 401) return new Set();
  if (!res.ok) throw new Error("Favoriten konnten nicht geladen werden");
  return zvgFavoriteIds(await res.json());
}

export function useFavoritedListingIds(): Set<string> {
  const { data } = useQuery({
    queryKey: FAVORITES_LIST_QUERY_KEY,
    queryFn: fetchZvgFavoriteIds,
    staleTime: 30 * 1000,
    retry: 1,
  });
  return data ?? new Set();
}
