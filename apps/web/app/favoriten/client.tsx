"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Filter, Bell } from "lucide-react";
import { ListingCard, type ZvgListingCardData } from "@/components/zvg/listing-card";
import { EmptyState } from "@/components/ui/empty-state";
import { CategoryTag, type Kategorie } from "@/components/ui/category-accent";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface FavoriteEntry {
  kind: "zvg" | "real_estate";
  listing: ZvgListingCardData;
  addedAt: Date | string;
  href: string;
  sourceBadge: string;
  angebotstyp?: string | null;
  notiz?: string | null;
}

function favoriteIdentityKey(entries: FavoriteEntry[]): string {
  return entries
    .map((entry) => `${entry.kind}:${entry.listing.id}`)
    .sort()
    .join("\0");
}

function timeMs(value: Date | string | null | undefined): number {
  if (value == null) return Number.NaN;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

const KATEGORIEN: { key: Kategorie; label: string }[] = [
  { key: "wohnung", label: "Wohnung" },
  { key: "haus", label: "Haus" },
  { key: "grundstueck", label: "Grundstück" },
  { key: "gewerbe", label: "Gewerbe" },
];

type FavoritenSort = "added-desc" | "termin-asc" | "preis-asc" | "preis-desc";

function favoritenSorts(
  hasZvg: boolean,
  hasCustom: boolean,
): { key: FavoritenSort; label: string }[] {
  const preisLabel = hasCustom && !hasZvg ? "Preis" : hasCustom ? "Preis / VW" : "Verkehrswert";
  return [
    { key: "added-desc", label: "Zuletzt hinzugefügt" },
    ...(hasZvg ? [{ key: "termin-asc" as const, label: "Termin · nächste zuerst" }] : []),
    { key: "preis-asc", label: `${preisLabel} · niedrig` },
    { key: "preis-desc", label: `${preisLabel} · hoch` },
  ];
}

export function FavoritenClient({ initialFavorites = [] }: { initialFavorites?: FavoriteEntry[] }) {
  const router = useRouter();
  const [favorites, setFavorites] = useState(initialFavorites);
  const syncedKeyRef = useRef(favoriteIdentityKey(initialFavorites));
  const [filterKat, setFilterKat] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<FavoritenSort>("added-desc");

  useEffect(() => {
    const nextKey = favoriteIdentityKey(initialFavorites);
    if (nextKey === syncedKeyRef.current) return;
    syncedKeyRef.current = nextKey;
    setFavorites(initialFavorites);
  }, [initialFavorites]);

  const hasZvg = favorites.some((f) => f.kind === "zvg");
  const hasCustom = favorites.some((f) => f.kind === "real_estate");
  const sorts = favoritenSorts(hasZvg, hasCustom);

  const filtered = useMemo(() => {
    const arr = favorites.filter((f) => {
      if (filterKat.size === 0) return true;
      return f.listing.kategorie && filterKat.has(f.listing.kategorie);
    });
    return arr.sort((a, b) => {
      if (sort === "added-desc") return timeMs(b.addedAt) - timeMs(a.addedAt);
      if (sort === "termin-asc") {
        const ta = timeMs(a.listing.terminDate);
        const tb = timeMs(b.listing.terminDate);
        return (Number.isFinite(ta) ? ta : Infinity) - (Number.isFinite(tb) ? tb : Infinity);
      }
      if (sort === "preis-asc")
        return (a.listing.verkehrswert ?? 0) - (b.listing.verkehrswert ?? 0);
      if (sort === "preis-desc")
        return (b.listing.verkehrswert ?? 0) - (a.listing.verkehrswert ?? 0);
      return 0;
    });
  }, [favorites, filterKat, sort]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of favorites) {
      if (f.listing.kategorie) c[f.listing.kategorie] = (c[f.listing.kategorie] ?? 0) + 1;
    }
    return c;
  }, [favorites]);

  const totalValue = useMemo(
    () =>
      favorites.reduce((s, f) => {
        if (f.angebotstyp === "miete") return s;
        return s + (f.listing.verkehrswert ?? 0);
      }, 0),
    [favorites],
  );

  // Leitet sinnvolle Vorbefüllungs-Kriterien für einen neuen Alert aus dem
  // aktuellen Favoriten-Bestand ab: häufigste Kategorie/häufigstes Bundesland
  // (nur wenn sie eine klare Mehrheit stellen, sonst offen lassen) sowie eine
  // Preisspanne mit ±20% Puffer um Min/Max-Verkehrswert der Favoriten.
  const alertHref = useMemo(() => {
    // Alerts bleiben ZVG-only — Custom-Favoriten nicht in Alert-Kriterien mischen.
    const zvgFavs = favorites.filter((f) => f.kind === "zvg");
    const total = zvgFavs.length;
    const params = new URLSearchParams();
    if (total === 0) return "/account/alerts/new";

    const topEntry = (values: Array<string | null | undefined>): [string, number] | null => {
      const counts = new Map<string, number>();
      for (const value of values) {
        if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      let top: [string, number] | null = null;
      for (const entry of counts) {
        if (!top || entry[1] > top[1]) top = entry;
      }
      return top;
    };

    const topKategorie = topEntry(zvgFavs.map((f) => f.listing.kategorie));
    if (topKategorie && topKategorie[1] / total >= 0.5) {
      params.set("kategorie", topKategorie[0]);
    }

    const topBundesland = topEntry(zvgFavs.map((f) => f.listing.bundesland));
    if (topBundesland && topBundesland[1] / total >= 0.5) {
      params.set("bundesland", topBundesland[0]);
    }

    const preise = zvgFavs.map((f) => f.listing.verkehrswert).filter((v): v is number => v != null);
    if (preise.length > 0) {
      const min = Math.min(...preise);
      const max = Math.max(...preise);
      const roundTo = (v: number) => Math.round(v / 1000) * 1000;
      params.set("preisMin", String(Math.max(0, roundTo(min * 0.8))));
      params.set("preisMax", String(roundTo(max * 1.2)));
    }

    params.set("quelle", "favoriten");
    params.set("anzahl", String(total));

    return `/account/alerts/new?${params.toString()}`;
  }, [favorites]);

  if (favorites.length === 0) {
    return <FavoritenEmpty />;
  }

  return (
    <>
      {/* HEADER */}
      <div className="px-6 py-4 border-b border-border/40">
        <div className="font-mono text-[11px] text-muted-foreground mb-1.5">
          <span className="text-foreground">Favoriten</span>
        </div>
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <div className="flex items-baseline gap-3.5">
            <h1 className="text-2xl font-semibold tracking-tight">Favoriten</h1>
            <span className="font-mono text-xs text-muted-foreground">
              {favorites.length} Objekte ·{" "}
              <span className="text-foreground">Σ {totalValue.toLocaleString("de-DE")} €</span> (VW
              / Angebotspreis)
            </span>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href={alertHref}>
              <Bell className="size-3" />
              Aus Favoriten Alert erstellen
            </Link>
          </Button>
        </div>
      </div>

      {/* TOOLBAR */}
      <div className="flex items-center gap-2 px-6 py-2 border-b border-border bg-[var(--surface-toolbar)] flex-wrap sticky top-0 z-10">
        <Filter className="size-3 text-muted-foreground" />
        <span className="label-mono pr-1">Kategorie</span>
        {KATEGORIEN.map((k) => {
          const active = filterKat.has(k.key as string);
          const cnt = counts[k.key as string] ?? 0;
          if (cnt === 0) return null;
          return (
            <button
              key={k.key}
              type="button"
              onClick={() => {
                const next = new Set(filterKat);
                if (active) next.delete(k.key as string);
                else next.add(k.key as string);
                setFilterKat(next);
              }}
              className={cn(
                "inline-flex items-center gap-1.5 pl-2 pr-2 py-0.5 rounded-[4px] transition-colors border",
                active
                  ? "bg-[var(--primary-container)] text-[var(--primary-container-fg)] border-transparent"
                  : "border-border hover:border-foreground/40",
              )}
            >
              <CategoryTag kategorie={k.key} className="border-0 bg-transparent p-0" />
              <span className="text-xs">{k.label}</span>
              <span className="font-mono text-[10px] text-muted-foreground">{cnt}</span>
            </button>
          );
        })}
        {filterKat.size > 0 && (
          <button
            type="button"
            onClick={() => setFilterKat(new Set())}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors ml-1"
          >
            Filter entfernen
          </button>
        )}
        <span className="flex-1" />
        <span className="text-xs text-muted-foreground">Sortierung:</span>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as FavoritenSort)}
          className="font-mono text-[11px] px-2 py-1 border border-border rounded-[4px] bg-background hover:border-foreground/40 transition-colors"
        >
          {sorts.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {/* GRID */}
      <main className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 content-start">
        {filtered.map((f) => (
          <ListingCard
            key={`${f.kind}-${f.listing.id}`}
            listing={f.listing}
            isFavorited
            href={f.href}
            sourceBadge={f.sourceBadge}
            listingType={f.kind}
            onFavoritedChange={(favorited) => {
              if (favorited) return;
              setFavorites((prev) =>
                prev.filter(
                  (entry) => !(entry.kind === f.kind && entry.listing.id === f.listing.id),
                ),
              );
              router.refresh();
            }}
          />
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full">
            <EmptyState
              message="Keine Favoriten in dieser Kategorie."
              action={
                <button
                  type="button"
                  onClick={() => setFilterKat(new Set())}
                  className="font-mono text-xs text-foreground hover:underline"
                >
                  Filter zurücksetzen
                </button>
              }
            />
          </div>
        )}
      </main>
    </>
  );
}

function FavoritenEmpty() {
  return (
    <div className="px-6 py-8 max-w-[var(--page-max-width)] mx-auto">
      <p className="label-mono mb-1">Favoriten · 0</p>
      <h1 className="text-2xl font-semibold tracking-tight mb-6">Favoriten</h1>
      <EmptyState
        message="Noch keine Objekte gespeichert. Plus auf einer Listing-Card sichert sie hier."
        action={
          <Link href="/" className="font-mono text-xs text-foreground hover:underline">
            Zur Übersicht
          </Link>
        }
      />
    </div>
  );
}
