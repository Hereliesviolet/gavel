"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Building2, MapPin, Ruler, Calendar } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { listingImageSrc } from "@/lib/safe-url";
import { formatCurrency, formatDate } from "@/lib/utils";
import { zvgListingPath } from "@/lib/zvg-documents";
import { listingKategorieFuerPeer, listingKategorieLabel } from "@/lib/listing-kategorie";

interface Objekt {
  id: string;
  slug: string;
  bundesland: string;
  bundeslandName: string | null;
  adresse: string | null;
  ort: string | null;
  typ: string | null;
  kategorie: string | null;
  verkehrswert: number | null;
  terminDate: string | null;
  amtsgericht: string | null;
  wohnflaecheM2: string | null;
  istNeu: boolean | null;
  coverImageUrl: string | null;
}

const KATEGORIE_COLORS: Record<string, string> = {
  wohnung: "bg-[var(--kat-wohnung-container)] text-[var(--kat-wohnung)]",
  haus: "bg-[var(--kat-haus-container)] text-[var(--kat-haus)]",
  grundstueck: "bg-[var(--kat-grundstueck-container)] text-[var(--kat-grundstueck)]",
  gewerbe: "bg-[var(--kat-gewerbe-container)] text-[var(--kat-gewerbe)]",
};

export function AlleObjekteSheet() {
  const [open, setOpen] = useState(false);

  const {
    data: objekte,
    isLoading,
    isError,
  } = useQuery<Objekt[]>({
    queryKey: ["alle-objekte"],
    queryFn: async () => {
      const res = await fetch("/api/objekte");
      if (!res.ok) throw new Error("Fehler beim Laden");
      const data: unknown = await res.json();
      if (
        typeof data !== "object" ||
        data == null ||
        !Array.isArray((data as { listings?: unknown }).listings)
      ) {
        throw new Error("Ungültige Antwort");
      }
      return (data as { listings: Objekt[] }).listings;
    },
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger className="text-sm text-primary hover:underline flex items-center gap-1 cursor-pointer bg-transparent border-0 p-0">
        Alle anzeigen
        <ArrowRight className="size-3" />
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-xl p-0">
        <SheetHeader className="px-6 py-4 border-b border-border">
          <SheetTitle className="flex items-center gap-2">
            <Building2 className="text-primary size-5" />
            Alle Objekte
            {objekte && (
              <Badge variant="secondary" className="ml-1">
                {objekte.length}
              </Badge>
            )}
          </SheetTitle>
        </SheetHeader>
        <ScrollArea className="h-[calc(100vh-80px)]">
          {isLoading ? (
            <div className="flex flex-col gap-3 p-6">
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={`skeleton-${i}`} className="h-20 w-full rounded-[4px]" />
              ))}
            </div>
          ) : isError ? (
            <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
              Objekte konnten nicht geladen werden.
            </div>
          ) : !objekte?.length ? (
            <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
              Keine Objekte gefunden.
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-border">
              {objekte.map((obj, idx) => {
                const coverSrc = listingImageSrc(obj.coverImageUrl);
                const kategorie = listingKategorieFuerPeer(obj.kategorie, obj.typ);
                return (
                  <Link
                    key={obj.id ?? `obj-${idx}`}
                    href={zvgListingPath(obj.bundesland, obj.slug) ?? "/"}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-4 px-6 py-3 hover:bg-muted/30 transition-colors"
                  >
                    {/* Thumbnail */}
                    <div className="relative shrink-0 size-12 rounded-[4px] bg-muted overflow-hidden">
                      {coverSrc ? (
                        <Image src={coverSrc} alt="" fill sizes="48px" className="object-cover" />
                      ) : (
                        <div className="size-full bg-muted flex items-center justify-center">
                          <Building2 className="text-muted-foreground size-4" />
                        </div>
                      )}
                    </div>

                    {/* Inhalt */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{obj.adresse}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {obj.istNeu && (
                          <span className="text-[10px] font-semibold px-1.5 py-px rounded bg-[var(--success-container)] text-[var(--success-container-fg)]">
                            NEU
                          </span>
                        )}
                        {kategorie && (
                          <span
                            className={`text-[10px] font-medium px-1.5 py-px rounded ${KATEGORIE_COLORS[kategorie] ?? "bg-muted text-muted-foreground"}`}
                          >
                            {listingKategorieLabel(obj.kategorie, obj.typ)}
                          </span>
                        )}
                        {obj.amtsgericht && (
                          <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                            <MapPin className="size-3 shrink-0" />
                            {obj.amtsgericht}
                          </span>
                        )}
                        {obj.wohnflaecheM2 && (
                          <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                            <Ruler className="size-3 shrink-0" />
                            {obj.wohnflaecheM2} m²
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Preis & Termin */}
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-primary tabular-nums">
                        {formatCurrency(obj.verkehrswert)}
                      </p>
                      {obj.terminDate && (
                        <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
                          {formatDate(new Date(obj.terminDate))}
                        </p>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
