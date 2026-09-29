import Link from "next/link";
import Image from "next/image";
import { Calendar, MapPin, Home } from "lucide-react";
import { FavoriteButton } from "@/components/shared/favorite-button";
import { listingImageNeedsBrowserCookies } from "@/lib/analyse-images";
import { listingImageSrc } from "@/lib/safe-url";
import { DISPLAY_TIME_ZONE, cn, formatClockTime, formatCurrency } from "@/lib/utils";
import { zvgListingPath } from "@/lib/zvg-documents";
import { CategoryAccent, CategoryTag, type Kategorie } from "@/components/ui/category-accent";
import { UrgencyBadge, daysUntil } from "@/components/ui/urgency-badge";
import { listingKategorieFuerPeer } from "@/lib/listing-kategorie";
import { listingFlaecheFuerPreis, listingPreisProM2 } from "@/lib/listing-preis";

export interface ZvgListingCardData {
  id: string;
  slug: string;
  bundesland: string;
  typ: string | null;
  kategorie: Kategorie;
  adresse: string | null;
  ort: string | null;
  verkehrswert: number | null;
  wohnflaecheM2: string | null;
  nutzflaecheM2?: string | null;
  zimmer: string | null;
  baujahr: number | null;
  terminDate: Date | null;
  amtsgericht: string | null;
  istNeu: boolean | null;
  denkmalschutz: boolean | null;
  vermietet: boolean | null;
  coverImageUrl?: string | null;
  lat?: string | number | null;
  lng?: string | number | null;
  preisIstMonatlich?: boolean;
  offline?: boolean;
}

/**
 * Carbon-style Listing-Card.
 * - 3px linker Border in Kategorie-Farbe
 * - Mono-Preis prominent
 * - 3-Spalten-Meta-Grid mit uppercase mini-labels
 * - Urgency-Badge im Termin-Bereich
 *
 * Layouts:
 *   variant="grid"  — Bild oben, Content unten (default, 4-col grids)
 *   variant="row"   — Bild links, Content rechts (2-col oder Listen)
 */
export function ListingCard({
  listing,
  isFavorited = false,
  variant = "grid",
  className,
  href,
  sourceBadge,
  listingType = "zvg",
  onFavoritedChange,
}: {
  listing: ZvgListingCardData;
  isFavorited?: boolean;
  variant?: "grid" | "row";
  className?: string;
  /** Override für Custom-Favoriten (`/analyse/...`) statt ZVG-Detailpfad. */
  href?: string;
  /** z.B. „Markt“ vs. „ZVG“ */
  sourceBadge?: string;
  listingType?: "zvg" | "real_estate";
  onFavoritedChange?: (favorited: boolean) => void;
}) {
  const tage = daysUntil(listing.terminDate);
  const kategorie = listingKategorieFuerPeer(listing.kategorie, listing.typ);
  const detailHref = href ?? zvgListingPath(listing.bundesland, listing.slug) ?? "/";
  const eurM2 = listingPreisProM2(listing.verkehrswert, listing);
  const flaeche = listingFlaecheFuerPreis(listing);

  const coverSrc = listingImageSrc(listing.coverImageUrl);
  const image = (
    <div className="relative bg-muted overflow-hidden aspect-[16/10]">
      {coverSrc ? (
        <Image
          src={coverSrc}
          alt={listing.typ ?? "Objekt"}
          fill
          unoptimized={listingImageNeedsBrowserCookies(coverSrc)}
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 230px"
          className="object-cover"
        />
      ) : (
        <div className="flex flex-col items-center justify-center h-full bg-muted/50 gap-1.5">
          <Home className="text-muted-foreground/20 size-8" />
          <span className="font-mono text-[9px] px-1.5 py-px rounded-[4px] border border-muted-foreground/20 text-muted-foreground/50 uppercase tracking-[0.08em]">
            Kein Bild
          </span>
        </div>
      )}

      <div className="absolute top-2 left-2 flex flex-wrap gap-1">
        {sourceBadge && (
          <span className="font-mono text-[10px] px-1.5 py-px rounded-[4px] bg-background/90 border border-border text-foreground uppercase tracking-[0.06em]">
            {sourceBadge}
          </span>
        )}
        <CategoryTag kategorie={kategorie} />
        {listing.istNeu && (
          <span className="font-mono text-[10px] px-1.5 py-px rounded-[4px] bg-[var(--success-container)] text-[var(--success-container-fg)]">
            NEU
          </span>
        )}
        {listing.offline && (
          <span className="font-mono text-[10px] px-1.5 py-px rounded-[4px] bg-[var(--warning-container)] text-[var(--warning-container-fg)]">
            Offline
          </span>
        )}
      </div>

      <FavoriteButton
        listingId={listing.id}
        listingType={listingType}
        initialFavorited={isFavorited}
        onFavoritedChange={onFavoritedChange}
        className="absolute top-2 right-2"
      />
    </div>
  );

  const content = (
    <div className="flex flex-col gap-1.5 p-3 min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-mono text-lg font-semibold tracking-tight leading-none">
          {listing.verkehrswert != null
            ? `${formatCurrency(listing.verkehrswert)}${listing.preisIstMonatlich ? " / Mo." : ""}`
            : "k.A."}
        </div>
        {eurM2 != null && (
          <div className="font-mono text-[10px] text-muted-foreground">
            {Math.round(eurM2).toLocaleString("de-DE")}{" "}
            {listing.preisIstMonatlich ? "€/m² · Miete" : "€/m²"}
          </div>
        )}
      </div>

      <div className="text-sm truncate">{listing.typ ?? "Immobilie"}</div>

      {(listing.adresse || listing.ort) && (
        <div className="text-[11px] text-muted-foreground flex items-center gap-1 truncate">
          <MapPin className="shrink-0 size-3" />
          {[listing.adresse, listing.ort].filter(Boolean).join(", ")}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/50 font-mono text-[11px]">
        {flaeche && <MiniFact label="FLÄCHE" value={`${flaeche.m2.toLocaleString("de-DE")} m²`} />}
        {listing.zimmer && <MiniFact label="ZIMMER" value={listing.zimmer} />}
        {listing.baujahr && <MiniFact label="BAUJAHR" value={String(listing.baujahr)} />}
      </div>

      {(listing.denkmalschutz || listing.vermietet) && (
        <div className="flex gap-1 flex-wrap pt-0.5">
          {listing.vermietet && (
            <span className="font-mono text-[9px] px-1.5 py-px border border-border rounded-[4px] text-muted-foreground uppercase tracking-[0.05em]">
              Vermietet
            </span>
          )}
          {listing.denkmalschutz && (
            <span className="font-mono text-[9px] px-1.5 py-px border border-border rounded-[4px] text-muted-foreground uppercase tracking-[0.05em]">
              Denkmal
            </span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between pt-2 mt-auto border-t border-border/50">
        <div className="flex items-center gap-1.5">
          <Calendar className="size-3 text-muted-foreground" />
          <span className="font-mono text-[11px]">
            {listing.terminDate
              ? [
                  new Date(listing.terminDate).toLocaleDateString("de-DE", {
                    timeZone: DISPLAY_TIME_ZONE,
                    weekday: "short",
                    day: "2-digit",
                    month: "2-digit",
                  }),
                  formatClockTime(listing.terminDate),
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "—"}
          </span>
          <UrgencyBadge days={tage} />
        </div>
        {listing.amtsgericht && (
          <span className="font-mono text-[10px] text-muted-foreground truncate max-w-[40%]">
            {listing.amtsgericht}
          </span>
        )}
      </div>
    </div>
  );

  return (
    <Link href={detailHref} className={cn("group block focus-visible:outline-none", className)}>
      <CategoryAccent
        kategorie={kategorie}
        className={cn(
          "bg-card border border-border rounded-[4px] overflow-hidden flex transition-colors hover:bg-muted/30",
          // Auf sehr schmalen Screens (< sm) wird die Row-Variante gestapelt,
          // damit die feste Bildbreite (180px) nicht eng an den Content stößt.
          variant === "row" ? "flex-col sm:flex-row" : "flex-col",
        )}
      >
        <div className={cn(variant === "row" ? "w-full sm:w-[180px] sm:shrink-0" : "w-full")}>
          {image}
        </div>
        <div className={cn("flex-1 min-w-0", variant === "row" && "sm:h-full")}>{content}</div>
      </CategoryAccent>
    </Link>
  );
}

function MiniFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground text-[9px] uppercase tracking-[0.08em]">{label}</div>
      <div className="text-foreground">{value}</div>
    </div>
  );
}

/** Skeleton-Variante für Loading-States. */
export function ListingCardSkeleton({ variant = "grid" }: { variant?: "grid" | "row" }) {
  return (
    <div
      className={cn(
        "bg-card border border-border border-l-[3px] border-l-border rounded-[4px] overflow-hidden flex animate-pulse",
        variant === "row" ? "flex-col sm:flex-row sm:h-[120px]" : "flex-col",
      )}
    >
      <div
        className={cn(
          variant === "row"
            ? "w-full aspect-[16/10] sm:w-[180px] sm:aspect-auto sm:shrink-0"
            : "w-full aspect-[16/10]",
          "bg-muted",
        )}
      />
      <div className="flex-1 p-3 space-y-2">
        <div className="h-5 w-24 bg-muted rounded-[4px]" />
        <div className="h-3 w-3/4 bg-muted rounded-[4px]" />
        <div className="h-2 w-1/2 bg-muted rounded-[4px]" />
      </div>
    </div>
  );
}
