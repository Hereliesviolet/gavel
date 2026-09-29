"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Calendar, MapPin } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { listingImageSrc } from "@/lib/safe-url";
import { DISPLAY_TIME_ZONE, formatCurrency } from "@/lib/utils";
import { zvgListingPath } from "@/lib/zvg-documents";

interface Termin {
  id: string;
  slug: string;
  bundesland: string;
  bundeslandName: string | null;
  adresse: string | null;
  ort: string | null;
  typ: string | null;
  verkehrswert: number | null;
  terminDate: string | null;
  amtsgericht: string | null;
  coverImageUrl: string | null;
}

export function AlleTermineSheet() {
  const [open, setOpen] = useState(false);

  const { data, isLoading, isError } = useQuery<{ termine: Termin[]; total: number }>({
    queryKey: ["alle-termine"],
    queryFn: async () => {
      const res = await fetch("/api/termine");
      if (!res.ok) throw new Error("Fehler beim Laden");
      const payload: unknown = await res.json();
      if (
        !payload ||
        typeof payload !== "object" ||
        !("termine" in payload) ||
        !Array.isArray((payload as { termine: unknown }).termine)
      ) {
        throw new Error("Ungültige Antwort");
      }
      const termine = (payload as { termine: Termin[] }).termine;
      const totalRaw = (payload as { total?: unknown }).total;
      const total = typeof totalRaw === "number" ? totalRaw : termine.length;
      return { termine, total };
    },
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });
  const termine = data?.termine;
  const total = data?.total ?? 0;

  const grouped =
    termine?.reduce<Record<string, Termin[]>>((acc, t) => {
      const key = t.terminDate
        ? new Date(t.terminDate).toLocaleDateString("de-DE", {
            day: "2-digit",
            month: "long",
            year: "numeric",
            timeZone: DISPLAY_TIME_ZONE,
          })
        : "Unbekannt";
      if (!acc[key]) acc[key] = [];
      acc[key].push(t);
      return acc;
    }, {}) ?? {};

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger className="text-sm text-primary hover:underline flex items-center gap-1 cursor-pointer bg-transparent border-0 p-0">
        Alle anzeigen
        <ArrowRight className="size-3" />
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-xl p-0">
        <SheetHeader className="px-6 py-4 border-b border-border">
          <SheetTitle className="flex items-center gap-2">
            <Calendar className="text-primary size-5" />
            Alle Versteigerungstermine
            {termine && total > termine.length
              ? ` · ${termine.length.toLocaleString("de-DE")} von ${total.toLocaleString("de-DE")}`
              : ""}
          </SheetTitle>
        </SheetHeader>
        <ScrollArea className="h-[calc(100vh-80px)]">
          {isLoading ? (
            <div className="flex flex-col gap-3 p-6">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-[4px]" />
              ))}
            </div>
          ) : isError ? (
            <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
              Termine konnten nicht geladen werden.
            </div>
          ) : Object.keys(grouped).length === 0 ? (
            <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
              Keine Termine gefunden.
            </div>
          ) : (
            <div className="flex flex-col gap-0">
              {Object.entries(grouped).map(([datum, items]) => (
                <div key={datum}>
                  <div className="px-6 py-3 bg-muted/40 border-b border-border">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      {datum} · {items.length} {items.length === 1 ? "Objekt" : "Objekte"}
                    </p>
                  </div>
                  {items.map((t, idx) => {
                    const coverSrc = listingImageSrc(t.coverImageUrl);
                    return (
                      <div key={t.id}>
                        <Link
                          href={zvgListingPath(t.bundesland, t.slug) ?? "/"}
                          onClick={() => setOpen(false)}
                          className="flex items-start gap-3 px-6 py-4 hover:bg-muted/30 transition-colors"
                        >
                          {/* Thumbnail */}
                          <div className="relative shrink-0 size-12 rounded-[4px] bg-muted overflow-hidden">
                            {coverSrc ? (
                              <Image
                                src={coverSrc}
                                alt=""
                                fill
                                sizes="48px"
                                className="object-cover"
                              />
                            ) : (
                              <div className="size-full bg-muted flex items-center justify-center">
                                <MapPin className="text-muted-foreground size-4" />
                              </div>
                            )}
                          </div>
                          {/* Inhalt */}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">
                              {t.typ ?? "Immobilie"} — {t.adresse}
                            </p>
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                              <MapPin className="size-3 shrink-0" />
                              {t.amtsgericht ?? t.ort}
                            </p>
                          </div>
                          {/* Preis & Bundesland */}
                          <div className="text-right shrink-0">
                            <p className="text-sm font-bold text-primary">
                              {formatCurrency(t.verkehrswert)}
                            </p>
                            {t.bundeslandName && (
                              <Badge variant="outline" className="text-xs mt-1">
                                {t.bundeslandName}
                              </Badge>
                            )}
                          </div>
                        </Link>
                        {idx < items.length - 1 && <Separator className="mx-6" />}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
