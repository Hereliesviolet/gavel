"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2, MapPin, Map } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface GeoResult {
  label: string;
  bundesland: string;
  lat?: number;
  lng?: number;
  plz?: string;
}

export function SearchForm() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoResult[]>([]);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setQuery(val);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (val.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      startTransition(async () => {
        try {
          const res = await fetch(`/api/geo/de/suche?query=${encodeURIComponent(val)}`);
          const data = await res.json();
          setResults(data.results ?? []);
          setOpen(true);
        } catch {
          setResults([]);
        }
      });
    }, 300);
  }

  function handleSelect(result: GeoResult) {
    setOpen(false);
    setQuery(result.label);

    if (result.bundesland && result.bundesland !== "deutschland") {
      const params = new URLSearchParams();
      if (result.plz) params.set("plz", result.plz);
      if (result.lat) params.set("lat", String(result.lat));
      if (result.lng) params.set("lng", String(result.lng));
      const qs = params.toString();
      router.push(`/${result.bundesland}${qs ? `?${qs}` : ""}`);
    } else {
      router.push(`/`);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (results.length > 0) {
      handleSelect(results[0]);
    } else if (query.trim()) {
      router.push(`/?q=${encodeURIComponent(query.trim())}`);
    }
  }

  return (
    <div ref={containerRef} className="relative max-w-lg mx-auto">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none size-4" />
          <Input
            type="text"
            value={query}
            onChange={handleChange}
            onFocus={() => results.length > 0 && setOpen(true)}
            placeholder="Stadt, PLZ oder Bundesland..."
            autoComplete="off"
            className="pl-10 py-3 h-auto"
          />
          {isPending && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground animate-spin size-4" />
          )}
        </div>
        <Button type="submit" className="whitespace-nowrap">
          Suchen
        </Button>
      </form>

      {/* Dropdown */}
      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-popover border border-border rounded-[4px] z-50 overflow-hidden">
          {results.map((result, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleSelect(result)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent transition-colors border-b border-border last:border-0"
            >
              {result.bundesland === "deutschland" ? (
                <Map className="text-muted-foreground shrink-0 size-4" />
              ) : (
                <MapPin className="text-primary shrink-0 size-4" />
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{result.label}</p>
                {result.bundesland && result.bundesland !== "deutschland" && (
                  <p className="text-xs text-muted-foreground capitalize">
                    {result.bundesland.replace(/-/g, " ")}
                    {result.plz ? ` · ${result.plz}` : ""}
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
