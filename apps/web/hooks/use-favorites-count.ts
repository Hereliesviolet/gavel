"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FAVORITES_LIST_QUERY_KEY } from "@/hooks/use-favorited-listing-ids";

/**
 * Geteilter Query-Key für die Favoriten-Gesamtzahl. Da die App eine einzige
 * QueryClient-Instanz über den gesamten Client-Baum teilt (siehe app/providers.tsx),
 * können Navbar (Anzeige) und FavoriteButton (Mutation) darüber synchron gehalten
 * werden, ohne Context/Prop-Drilling und ohne vollständigen Seiten-Reload.
 */
export const FAVORITES_COUNT_QUERY_KEY = ["favorites-count"] as const;

async function fetchFavoritesCount(): Promise<number> {
  const res = await fetch("/api/favorites");
  if (!res.ok) throw new Error("Favoriten konnten nicht geladen werden");
  const data: unknown = await res.json();
  const favorites =
    data && typeof data === "object" && "favorites" in data
      ? (data as { favorites: unknown }).favorites
      : null;
  if (!Array.isArray(favorites)) {
    throw new Error("Favoriten konnten nicht geladen werden");
  }
  return favorites.length;
}

/**
 * Liefert die aktuelle Favoriten-Gesamtzahl.
 *
 * `initialCount` kommt aus dem Server-Layout (erster Seitenaufruf, kein Flackern),
 * wird danach aber ausschließlich clientseitig über React Query aktuell gehalten -
 * u.a. weil das Root-Layout (und damit die Navbar) bei Client-Side-Navigation
 * zwischen Seiten von Next.js nicht neu ausgeführt wird und ein serverseitig
 * berechneter Wert dadurch dauerhaft veraltet bliebe.
 */
export function useFavoritesCount(initialCount = 0): number {
  const { data } = useQuery({
    queryKey: FAVORITES_COUNT_QUERY_KEY,
    queryFn: fetchFavoritesCount,
    initialData: initialCount,
    staleTime: 30 * 1000,
    retry: 1,
  });
  return data;
}

/** Für optimistische Updates direkt aus dem FavoriteButton heraus. */
export function useAdjustFavoritesCount() {
  const queryClient = useQueryClient();

  return (delta: 1 | -1) => {
    queryClient.setQueryData<number>(FAVORITES_COUNT_QUERY_KEY, (prev) =>
      Math.max(0, (prev ?? 0) + delta),
    );
    // Im Hintergrund mit dem echten Serverstand abgleichen (z.B. falls der
    // Favorit in einem anderen Tab bereits verändert wurde).
    queryClient.invalidateQueries({ queryKey: FAVORITES_COUNT_QUERY_KEY });
    queryClient.invalidateQueries({ queryKey: FAVORITES_LIST_QUERY_KEY });
  };
}
