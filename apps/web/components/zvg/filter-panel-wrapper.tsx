"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Filter } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetClose,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FilterPanel,
  FilterState,
  defaultFilterState,
  countActiveFilters,
} from "@/components/zvg/filter-panel";

function filterStateFromParams(sp: URLSearchParams): FilterState {
  const def = defaultFilterState();
  const minPreis = parseInt(sp.get("min_preis") ?? "");
  const maxPreis = parseInt(sp.get("max_preis") ?? "");
  const minFlaeche = parseFloat(sp.get("min_flaeche") ?? "");
  const maxFlaeche = parseFloat(sp.get("max_flaeche") ?? "");
  const minTermin = parseInt(sp.get("min_termin") ?? "");
  const maxTermin = parseInt(sp.get("max_termin") ?? "");

  return {
    preis: [!isNaN(minPreis) ? minPreis : def.preis[0], !isNaN(maxPreis) ? maxPreis : def.preis[1]],
    flaeche: [
      !isNaN(minFlaeche) ? minFlaeche : def.flaeche[0],
      !isNaN(maxFlaeche) ? maxFlaeche : def.flaeche[1],
    ],
    termin: [
      !isNaN(minTermin) ? minTermin : def.termin[0],
      !isNaN(maxTermin) ? maxTermin : def.termin[1],
    ],
    kategorien: sp.getAll("kategorie"),
    status: sp.getAll("status"),
    amtsgerichte: sp.getAll("amtsgericht"),
  };
}

function filterStateToParams(state: FilterState): URLSearchParams {
  const def = defaultFilterState();
  const params = new URLSearchParams();

  if (state.preis[0] !== def.preis[0]) params.set("min_preis", String(state.preis[0]));
  if (state.preis[1] !== def.preis[1]) params.set("max_preis", String(state.preis[1]));
  if (state.flaeche[0] !== def.flaeche[0]) params.set("min_flaeche", String(state.flaeche[0]));
  if (state.flaeche[1] !== def.flaeche[1]) params.set("max_flaeche", String(state.flaeche[1]));
  if (state.termin[0] !== def.termin[0]) params.set("min_termin", String(state.termin[0]));
  if (state.termin[1] !== def.termin[1]) params.set("max_termin", String(state.termin[1]));
  state.kategorien.forEach((k) => params.append("kategorie", k));
  state.status.forEach((s) => params.append("status", s));
  state.amtsgerichte.forEach((a) => params.append("amtsgericht", a));

  return params;
}

/**
 * Gemeinsame Zustandslogik für Desktop-Sidebar und Mobile-Sheet.
 * Beide Varianten sind gleichzeitig im DOM (nur per CSS ein-/ausgeblendet),
 * daher wird der lokale State bei jeder Änderung der URL-Query neu aus den
 * Suchparametern abgeleitet - so bleiben beide Instanzen synchron, auch wenn
 * die jeweils andere zuletzt eine Änderung vorgenommen hat.
 */
function useFilterPanelState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const spString = searchParams.toString();

  const [filterState, setFilterState] = useState<FilterState>(() =>
    filterStateFromParams(new URLSearchParams(spString)),
  );

  useEffect(() => {
    setFilterState(filterStateFromParams(new URLSearchParams(spString)));
  }, [spString]);

  const handleChange = useCallback(
    (next: FilterState) => {
      setFilterState(next);
      const params = filterStateToParams(next);
      const sort = searchParams.get("sort");
      if (sort) params.set("sort", sort);
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const handleReset = useCallback(() => {
    const def = defaultFilterState();
    setFilterState(def);
    const sort = searchParams.get("sort");
    const params = new URLSearchParams();
    if (sort) params.set("sort", sort);
    router.push(`${pathname}${params.toString() ? `?${params.toString()}` : ""}`, {
      scroll: false,
    });
  }, [pathname, router, searchParams]);

  return { filterState, handleChange, handleReset };
}

/** Permanente Filter-Sidebar (Desktop, ab `lg`). */
export function FilterPanelWrapper({
  amtsgerichte,
  className,
}: {
  amtsgerichte: Array<{ key: string; label: string }>;
  className?: string;
}) {
  const { filterState, handleChange, handleReset } = useFilterPanelState();

  return (
    <FilterPanel
      value={filterState}
      onChange={handleChange}
      amtsgerichte={amtsgerichte}
      onReset={handleReset}
      className={className}
    />
  );
}

/** Ausklappbares Filter-Sheet für Mobile/Tablet (< `lg`), da die Sidebar dort ausgeblendet ist. */
export function MobileFilterSheet({
  amtsgerichte,
}: {
  amtsgerichte: Array<{ key: string; label: string }>;
}) {
  const [open, setOpen] = useState(false);
  const { filterState, handleChange, handleReset } = useFilterPanelState();
  const activeCount = countActiveFilters(filterState);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={<Button variant="outline" size="sm" className="gap-1.5 font-mono text-xs" />}
      >
        <Filter className="size-3.5" />
        Filter
        {activeCount > 0 && (
          <Badge className="h-5 min-w-5 px-1 justify-center rounded-full">{activeCount}</Badge>
        )}
      </SheetTrigger>
      <SheetContent side="left" className="w-3/4 sm:max-w-sm p-0 flex flex-col gap-0">
        <SheetHeader className="px-4 py-4 border-b border-border">
          <SheetTitle>Filter{activeCount > 0 ? ` · ${activeCount} aktiv` : ""}</SheetTitle>
        </SheetHeader>
        <ScrollArea className="flex-1 min-h-0">
          <FilterPanel
            value={filterState}
            onChange={handleChange}
            amtsgerichte={amtsgerichte}
            onReset={handleReset}
            className="border-r-0 border-0"
          />
        </ScrollArea>
        <div className="p-3 border-t border-border shrink-0">
          <SheetClose render={<Button className="w-full min-h-11" size="lg" />}>
            Filter anwenden & schließen
          </SheetClose>
        </div>
      </SheetContent>
    </Sheet>
  );
}
