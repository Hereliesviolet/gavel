"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { LayoutGrid, Map } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { MapPin } from "./map-view";
import { isUsableGeoPoint } from "@/lib/geo-point";

// maplibre-gl (~208 KB gzip) nur
// laden, wenn der Nutzer tatsächlich auf "Kartenansicht" umschaltet, statt
// statisch auf jeder Bundesland-Listing-Seite mitzubündeln - analog zum
// bereits bestehenden Muster in components/zvg/detail/standort-map.tsx.
const MapView = dynamic(() => import("./map-view").then((mod) => mod.MapView), {
  ssr: false,
  loading: () => (
    <div
      className="flex items-center justify-center rounded-[4px] border border-gray-200 bg-gray-50 text-sm text-gray-500"
      style={{ height: "500px" }}
    >
      Karte wird geladen…
    </div>
  ),
});

interface ViewToggleProps {
  pins: MapPin[];
  children: React.ReactNode;
}

export function ViewToggle({ pins, children }: ViewToggleProps) {
  const [view, setView] = useState<"grid" | "map">("grid");
  const validPins = pins.filter((p) => isUsableGeoPoint(p.lat, p.lng));

  return (
    <div>
      <div className="flex justify-end mb-4">
        <ToggleGroup
          value={[view]}
          onValueChange={(v) => {
            const next = (v as string[])[0] as "grid" | "map" | undefined;
            if (next) setView(next);
          }}
        >
          <ToggleGroupItem
            value="grid"
            aria-label="Gitteransicht"
            className="size-10 touch-manipulation"
          >
            <LayoutGrid className="size-4" />
          </ToggleGroupItem>
          <ToggleGroupItem
            value="map"
            aria-label="Kartenansicht"
            className="relative size-10 touch-manipulation"
            title={
              validPins.length === 0
                ? "Noch keine Koordinaten verfügbar"
                : `${validPins.length} Objekte auf Karte`
            }
          >
            <Map className="size-4" />
            {validPins.length > 0 && view !== "map" && (
              <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[10px] rounded-full size-4 flex items-center justify-center font-bold">
                {validPins.length > 9 ? "9+" : validPins.length}
              </span>
            )}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {view === "grid" ? children : <MapView pins={pins} />}
    </div>
  );
}
