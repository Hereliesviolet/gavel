"use client";

import { useEffect, useRef, useState } from "react";
import type { SearchSuggestions } from "@/app/api/search-suggestions/route";
import { flattenSuggestions, type FlatSuggestionItem } from "@/lib/search-suggestions";

const EMPTY_SUGGESTIONS: SearchSuggestions = {
  orte: [],
  amtsgerichte: [],
  plz: [],
  listings: [],
};

interface UseSearchSuggestionsOptions {
  minLength?: number;
  debounceMs?: number;
}

/**
 * Lädt (debounced) Autocomplete-Vorschläge für Orte, Amtsgerichte, PLZ und Objekte
 * zu einer Sucheingabe und verwaltet zusätzlich die per Tastatur "aktive" Auswahl.
 */
export function useSearchSuggestions(query: string, options: UseSearchSuggestionsOptions = {}) {
  const { minLength = 2, debounceMs = 300 } = options;

  const [suggestions, setSuggestions] = useState<SearchSuggestions>(EMPTY_SUGGESTIONS);
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = query.trim();
    if (trimmed.length < minLength) {
      requestIdRef.current += 1;
      setSuggestions(EMPTY_SUGGESTIONS);
      setIsError(false);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setIsError(false);
    debounceRef.current = setTimeout(() => {
      const requestId = (requestIdRef.current += 1);
      fetch(`/api/search-suggestions?q=${encodeURIComponent(trimmed)}`)
        .then(async (res) => {
          if (!res.ok) throw new Error("Suchvorschläge nicht verfügbar");
          const data: unknown = await res.json();
          if (!data || typeof data !== "object") {
            throw new Error("Ungültige Antwort");
          }
          const row = data as SearchSuggestions;
          if (
            !Array.isArray(row.orte) ||
            !Array.isArray(row.amtsgerichte) ||
            !Array.isArray(row.plz) ||
            !Array.isArray(row.listings)
          ) {
            throw new Error("Ungültige Antwort");
          }
          return row;
        })
        .then((data) => {
          if (requestId === requestIdRef.current) {
            setSuggestions(data);
            setIsError(false);
            setIsLoading(false);
          }
        })
        .catch(() => {
          if (requestId === requestIdRef.current) {
            setIsError(true);
            setIsLoading(false);
          }
        });
    }, debounceMs);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, minLength, debounceMs]);

  const items = flattenSuggestions(suggestions);

  useEffect(() => {
    setActiveKey((current) => (items.some((item) => item.key === current) ? current : null));
  }, [items]);

  function moveActive(direction: 1 | -1) {
    if (items.length === 0) return;
    const currentIndex = items.findIndex((item) => item.key === activeKey);
    const nextIndex =
      currentIndex === -1
        ? direction === 1
          ? 0
          : items.length - 1
        : (currentIndex + direction + items.length) % items.length;
    setActiveKey(items[nextIndex].key);
  }

  function getActiveItem(): FlatSuggestionItem | null {
    return items.find((item) => item.key === activeKey) ?? null;
  }

  function reset() {
    requestIdRef.current += 1;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSuggestions(EMPTY_SUGGESTIONS);
    setIsError(false);
    setActiveKey(null);
    setIsLoading(false);
  }

  return {
    suggestions,
    items,
    isLoading,
    isError,
    activeKey,
    setActiveKey,
    moveActive,
    getActiveItem,
    reset,
  };
}
