import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { zvgListings } from "@/drizzle/schema";
import { favoritedListingIds } from "@/lib/favorite-write";
import { eq, and, count, lte, asc } from "drizzle-orm";
import { ListingGrid } from "@/components/zvg/listing-grid";
import { ZvgListingCardData } from "@/components/zvg/listing-card";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { ResultBar, ResultChip } from "@/components/ui/result-bar";
import { clipSearchQuery } from "@/lib/sql-like";
import { listingTextSearchSql } from "@/lib/listing-text-search";
import { LISTING_COVER_IMAGE_SQL } from "@/lib/listing-cover";
import { listingTypeColumnMatches } from "@/lib/listing-type-filter";
import { upcomingTerminSql } from "@/lib/termin-sql";
import { visiblePageNumbers } from "@/lib/utils";

export const metadata: Metadata = { title: "Suche · Gavel" };

interface SearchParams {
  q?: string;
  typ?: string;
  maxPreis?: string;
  vermietet?: string;
  denkmal?: string;
  page?: string;
}

const SEARCH_RESULT_LIMIT = 100;

const KATEGORIE_MAP: Record<string, string> = {
  wohnung: "wohnung",
  haus: "haus",
  grundstueck: "grundstueck",
  gewerbe: "gewerbe",
};

function suchePageHref(sp: SearchParams, page: number): string {
  const params = new URLSearchParams();
  if (sp.q) params.set("q", sp.q);
  if (sp.typ) params.set("typ", sp.typ);
  if (sp.maxPreis) params.set("maxPreis", sp.maxPreis);
  if (sp.vermietet) params.set("vermietet", sp.vermietet);
  if (sp.denkmal) params.set("denkmal", sp.denkmal);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/suche?${query}` : "/suche";
}

async function searchListings(sp: SearchParams) {
  const { q, typ, maxPreis, vermietet, denkmal, page: pageRaw } = sp;
  const page = Math.max(1, Number.parseInt(pageRaw ?? "1", 10) || 1);

  const conditions = [eq(zvgListings.istAktiv, true), upcomingTerminSql()];

  const query = q ? clipSearchQuery(q) : "";
  if (query) conditions.push(listingTextSearchSql(query));

  if (typ && KATEGORIE_MAP[typ]) {
    const typeMatch = listingTypeColumnMatches([KATEGORIE_MAP[typ]]);
    if (typeMatch) conditions.push(typeMatch);
  }

  if (maxPreis) {
    const max = Number(maxPreis);
    if (!isNaN(max)) conditions.push(lte(zvgListings.verkehrswert, String(max)));
  }

  if (vermietet === "1") conditions.push(eq(zvgListings.vermietet, true));
  if (denkmal === "1") conditions.push(eq(zvgListings.denkmalschutz, true));

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: zvgListings.id,
        slug: zvgListings.slug,
        bundesland: zvgListings.bundesland,
        typ: zvgListings.typ,
        kategorie: zvgListings.kategorie,
        adresse: zvgListings.adresse,
        ort: zvgListings.ort,
        verkehrswert: zvgListings.verkehrswert,
        wohnflaecheM2: zvgListings.wohnflaecheM2,
        nutzflaecheM2: zvgListings.nutzflaecheM2,
        zimmer: zvgListings.zimmer,
        baujahr: zvgListings.baujahr,
        terminDate: zvgListings.terminDate,
        amtsgericht: zvgListings.amtsgericht,
        istNeu: zvgListings.istNeu,
        denkmalschutz: zvgListings.denkmalschutz,
        vermietet: zvgListings.vermietet,
        lat: zvgListings.lat,
        lng: zvgListings.lng,
        coverImageUrl: LISTING_COVER_IMAGE_SQL,
      })
      .from(zvgListings)
      .where(and(...conditions))
      .orderBy(asc(zvgListings.terminDate), asc(zvgListings.id))
      .limit(SEARCH_RESULT_LIMIT)
      .offset((page - 1) * SEARCH_RESULT_LIMIT),
    db
      .select({ total: count() })
      .from(zvgListings)
      .where(and(...conditions)),
  ]);

  return {
    listings: rows as ZvgListingCardData[],
    total: Number(total ?? 0),
    page,
  };
}

export default async function SuchePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await auth();
  const sp = await searchParams;
  const { q, typ, maxPreis, vermietet, denkmal } = sp;
  const query = q ? clipSearchQuery(q) : "";

  const hasFilter = Boolean(query || typ || maxPreis || vermietet || denkmal);
  const result = hasFilter
    ? await searchListings({ ...sp, q: query })
    : { listings: [], total: 0, page: 1 };
  const listings = result.listings;
  const total = result.total;
  const pages = Math.max(1, Math.ceil(total / SEARCH_RESULT_LIMIT));
  const page = result.page;
  const favoritedIds = session?.user?.id
    ? [
        ...(await favoritedListingIds(
          session.user.id,
          listings.map((listing) => listing.id),
        )),
      ]
    : [];

  const chips = [
    typ && `Typ: ${typ}`,
    maxPreis && `≤ ${Number(maxPreis).toLocaleString("de-DE")} €`,
    vermietet === "1" && "Vermietet",
    denkmal === "1" && "Denkmalschutz",
  ]
    .filter(Boolean)
    .map((label) => <ResultChip key={String(label)}>{label}</ResultChip>);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Suche · Zwangsversteigerungen"
        title={query ? `"${query}"` : "Suche"}
        description="Aktive Verfahren nach Ort, Amtsgericht, Aktenzeichen oder Filter. Der Filter steht in der URL."
      />

      <div className="sticky top-14 z-30 -mx-4 sm:-mx-6 lg:-mx-8 border-b border-border bg-background px-4 sm:px-6 lg:px-8 py-3 mb-6">
        <form action="/suche" method="get">
          <div className="flex flex-col sm:flex-row gap-2 max-w-2xl">
            <input
              name="q"
              defaultValue={query}
              placeholder="PLZ, Stadt, Amtsgericht oder Aktenzeichen"
              className="flex-1 h-11 px-3 rounded-[4px] border border-input bg-background font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {typ && <input type="hidden" name="typ" value={typ} />}
            {maxPreis && <input type="hidden" name="maxPreis" value={maxPreis} />}
            {vermietet && <input type="hidden" name="vermietet" value={vermietet} />}
            {denkmal && <input type="hidden" name="denkmal" value={denkmal} />}
            <Button type="submit" className="shrink-0">
              Suchen
            </Button>
          </div>
        </form>
        {hasFilter ? (
          <ResultBar count={total} shown={listings.length} chips={chips} className="mt-2" />
        ) : null}
      </div>

      {!hasFilter ? (
        <EmptyState message="Suchbegriff oder Filter setzen — ohne Eingabe keine Trefferliste." />
      ) : listings.length === 0 ? (
        <EmptyState
          message={query ? `Keine Treffer für „${query}“.` : "Keine Treffer für diese Filter."}
          action={
            <Link href="/suche" className="font-mono text-xs text-foreground hover:underline">
              Filter zurücksetzen
            </Link>
          }
        />
      ) : (
        <>
          <ListingGrid listings={listings} favoritedIds={favoritedIds} />
          {pages > 1 && (
            <div className="flex items-center justify-center gap-1 mt-8">
              {page > 1 && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={suchePageHref({ ...sp, q: query }, page - 1)}>← Zurück</Link>
                </Button>
              )}
              {visiblePageNumbers(page, pages, 7).map((p) => (
                <Button key={p} variant={p === page ? "default" : "outline"} size="sm" asChild>
                  <Link href={suchePageHref({ ...sp, q: query }, p)}>{p}</Link>
                </Button>
              ))}
              {page < pages && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={suchePageHref({ ...sp, q: query }, page + 1)}>Weiter →</Link>
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}
