"use client";

import { useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ListingCard, type ZvgListingCardData } from "@/components/zvg/listing-card";
import { useFavoritedListingIds } from "@/hooks/use-favorited-listing-ids";
import type { Kategorie } from "@/components/ui/category-accent";

const LOAD_MORE_COUNT = 30;

/**
 * Serialisierbares Listing-Format (string statt Date/number für Decimal-Felder),
 * kompatibel mit API-Responses und RSC-Props vom Server.
 */
export interface NeuesteObjekteListing {
  id: string;
  slug: string;
  bundesland: string;
  typ: string | null;
  kategorie: string | null;
  adresse: string | null;
  ort: string | null;
  /** Decimal aus der DB → als String serialisiert */
  verkehrswert: string | null;
  /** Decimal aus der DB → als String serialisiert */
  wohnflaecheM2: string | null;
  nutzflaecheM2?: string | null;
  /** Decimal aus der DB → als String serialisiert */
  zimmer: string | null;
  baujahr: number | null;
  /** Timestamp als ISO-String serialisiert */
  terminDate: string | null;
  amtsgericht: string | null;
  istNeu: boolean | null;
  denkmalschutz: boolean | null;
  vermietet: boolean | null;
  createdAt?: string | null;
  coverImageUrl: string | null;
}

function toCardData(listing: NeuesteObjekteListing): ZvgListingCardData {
  return {
    id: listing.id,
    slug: listing.slug,
    bundesland: listing.bundesland,
    typ: listing.typ,
    kategorie: listing.kategorie as Kategorie,
    adresse: listing.adresse,
    ort: listing.ort,
    verkehrswert: listing.verkehrswert != null ? parseFloat(listing.verkehrswert) : null,
    wohnflaecheM2: listing.wohnflaecheM2,
    nutzflaecheM2: listing.nutzflaecheM2,
    zimmer: listing.zimmer,
    baujahr: listing.baujahr,
    terminDate: listing.terminDate ? new Date(listing.terminDate) : null,
    amtsgericht: listing.amtsgericht,
    istNeu: listing.istNeu,
    denkmalschutz: listing.denkmalschutz,
    vermietet: listing.vermietet,
    coverImageUrl: listing.coverImageUrl,
  };
}

interface Props {
  initialListings: NeuesteObjekteListing[];
  totalCount: number | null;
  sinceHours?: number;
}

export function NeusteObjekteSection({ initialListings, totalCount, sinceHours }: Props) {
  const [listings, setListings] = useState<NeuesteObjekteListing[]>(initialListings);
  const [knownTotal, setKnownTotal] = useState(totalCount);
  const [isLoading, setIsLoading] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const favoritedIds = useFavoritedListingIds();

  const countKnown = knownTotal != null;
  const hasMore = countKnown && !exhausted && listings.length < knownTotal;

  async function loadMore() {
    setIsLoading(true);
    setLoadError(false);
    try {
      const last = listings[listings.length - 1];
      const params = new URLSearchParams({
        limit: String(LOAD_MORE_COUNT),
      });
      if (sinceHours != null) params.set("sinceHours", String(sinceHours));
      else params.set("order", "created");
      if (last?.createdAt && last.id) {
        params.set("afterCreatedAt", last.createdAt);
        params.set("afterId", last.id);
      } else {
        params.set("offset", String(listings.length));
      }
      const res = await fetch(`/api/objekte?${params.toString()}`);
      if (!res.ok) throw new Error("Fehler beim Laden");
      const data: unknown = await res.json();
      if (
        typeof data !== "object" ||
        data == null ||
        !Array.isArray((data as { listings?: unknown }).listings)
      ) {
        throw new Error("Ungültige Antwort");
      }
      const payload = data as { listings: NeuesteObjekteListing[]; total?: number | null };
      const batch = payload.listings;
      if (typeof payload.total === "number") {
        setKnownTotal(payload.total);
      }
      setListings((prev) => {
        const existingIds = new Set(prev.map((l) => l.id));
        return [...prev, ...batch.filter((l) => !existingIds.has(l.id))];
      });
      if (batch.length < LOAD_MORE_COUNT) {
        setExhausted(true);
      }
    } catch {
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {listings.map((listing) => (
          <ListingCard
            key={listing.id}
            listing={toCardData(listing)}
            isFavorited={favoritedIds.has(listing.id)}
          />
        ))}
      </div>

      {loadError && (
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Objekte konnten nicht geladen werden.
        </p>
      )}
      {!countKnown && !loadError && (
        <p className="mt-6 text-center text-sm text-muted-foreground">Bestand unvollständig.</p>
      )}
      {hasMore && (
        <div className="flex justify-center mt-8">
          <Button variant="outline" onClick={loadMore} disabled={isLoading} className="gap-2">
            {isLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ChevronDown className="size-4" />
            )}
            {isLoading ? "Wird geladen\u2026" : "30 weitere laden"}
          </Button>
        </div>
      )}
    </>
  );
}
