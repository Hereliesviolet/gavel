"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSearchSuggestions } from "@/hooks/use-search-suggestions";
import { SuggestionsDropdown } from "@/components/zvg/suggestions-dropdown";
import { suggestionHref, type FlatSuggestionItem } from "@/lib/search-suggestions";

export function HeroSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const {
    suggestions,
    items,
    isLoading,
    isError,
    activeKey,
    setActiveKey,
    moveActive,
    getActiveItem,
  } = useSearchSuggestions(query);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function navigateToItem(item: FlatSuggestionItem) {
    setOpen(false);
    router.push(suggestionHref(item));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const active = getActiveItem();
    if (active) {
      navigateToItem(active);
      return;
    }
    if (query.trim()) {
      setOpen(false);
      router.push(`/suche?q=${encodeURIComponent(query.trim())}`);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      moveActive(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveActive(-1);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const showDropdown = open && query.trim().length >= 2;

  return (
    <div ref={containerRef} className="relative max-w-3xl mt-6">
      <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <div className="flex flex-1 overflow-hidden rounded-[4px] border border-border bg-card">
          <div className="flex items-center gap-2 border-r border-border px-4 text-muted-foreground">
            <Search className="size-4" />
            <span className="hidden text-xs text-muted-foreground sm:inline">
              PLZ, Stadt oder Amtsgericht
            </span>
          </div>
          <input
            name="q"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => query.trim().length >= 2 && setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder="PLZ, Stadt oder Amtsgericht"
            autoComplete="off"
            className="flex-1 bg-transparent px-3 py-3 text-sm outline-none sm:placeholder:hidden"
          />
          {isLoading && (
            <Loader2 className="my-auto mr-3 size-4 shrink-0 animate-spin text-muted-foreground" />
          )}
        </div>
        <Button type="submit" className="shrink-0">
          Suchen →
        </Button>
      </form>

      {showDropdown && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 max-h-96 overflow-y-auto rounded-[4px] border border-border bg-popover">
          {items.length > 0 ? (
            <SuggestionsDropdown
              suggestions={suggestions}
              activeKey={activeKey}
              onHover={setActiveKey}
              onSelect={navigateToItem}
            />
          ) : (
            <div className="px-3 py-3 text-xs text-muted-foreground">
              {isLoading
                ? "Suche läuft…"
                : isError
                  ? "Suchvorschläge nicht verfügbar."
                  : "Keine Vorschläge gefunden."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
