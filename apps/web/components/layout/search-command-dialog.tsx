"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useSearchSuggestions } from "@/hooks/use-search-suggestions";
import { SuggestionsDropdown } from "@/components/zvg/suggestions-dropdown";
import { suggestionHref } from "@/lib/search-suggestions";

interface SearchCommandDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Globale Quick-Suche (⌘K) in der Navbar. Anders als die Hero-Suche auf der Startseite
 * dient dieser Dialog als schneller Sprung zu Orten/Amtsgerichten/Objekten von überall
 * in der App aus – daher als Command-Palette statt als dauerhaft sichtbares Textfeld.
 */
export function SearchCommandDialog({ open, onOpenChange }: SearchCommandDialogProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    suggestions,
    items,
    isLoading,
    isError,
    activeKey,
    setActiveKey,
    moveActive,
    getActiveItem,
    reset,
  } = useSearchSuggestions(query);

  useEffect(() => {
    if (open) {
      setQuery("");
      reset();
      const timeout = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timeout);
    }
    // reset() ist stabil über die Lifetime des Hooks, muss hier nicht als Dependency geführt werden.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function navigate(href: string) {
    onOpenChange(false);
    router.push(href);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const active = getActiveItem();
    if (active) {
      navigate(suggestionHref(active));
      return;
    }
    if (query.trim()) navigate(`/suche?q=${encodeURIComponent(query.trim())}`);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveActive(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveActive(-1);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[20%] max-w-lg translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="sr-only">
          <DialogTitle>Suche</DialogTitle>
          <DialogDescription>Durchsuche Orte, Amtsgerichte, PLZ und Objekte</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-2 border-b border-border px-4"
        >
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="PLZ, Stadt, Amtsgericht oder Objekt durchsuchen…"
            autoComplete="off"
            className="flex-1 bg-transparent py-3 text-sm outline-none"
          />
          {isLoading && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />}
          <kbd className="hidden shrink-0 rounded border border-border px-1 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">
            ESC
          </kbd>
        </form>
        <div className="max-h-96 overflow-y-auto">
          {query.trim().length < 2 ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">
              Mindestens 2 Zeichen eingeben …
            </div>
          ) : items.length > 0 ? (
            <SuggestionsDropdown
              suggestions={suggestions}
              activeKey={activeKey}
              onHover={setActiveKey}
              onSelect={(item) => navigate(suggestionHref(item))}
            />
          ) : !isLoading ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">
              {isError ? "Suchvorschläge nicht verfügbar." : "Keine Vorschläge gefunden."}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
