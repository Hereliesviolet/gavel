import { db } from "@/lib/db";
import { zvgListings } from "@/drizzle/schema";
import { eq, and, count, desc } from "drizzle-orm";
import { BUNDESLAENDER } from "@/lib/utils";
import { bundeslandColumnMatches } from "@/lib/bundesland";
import { clipSearchQuery } from "@/lib/sql-like";
import { listingTextSearchSql } from "@/lib/listing-text-search";
import { isListingKategorie } from "@/lib/kategorien";
import { LISTING_COVER_IMAGE_SQL } from "@/lib/listing-cover";
import { listingTypeColumnMatches } from "@/lib/listing-type-filter";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { ResultBar } from "@/components/ui/result-bar";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HydratingListingGrid } from "@/components/zvg/hydrating-listing-grid";
import { ZvgListingCardData } from "@/components/zvg/listing-card";
import type { Kategorie } from "@/components/ui/category-accent";

export const metadata: Metadata = {
  title: "Archiv – Inaktive Verfahren | Gavel",
  description:
    "Verfahren, deren Termin vorbei ist oder die auf der Quelle nicht mehr geführt werden.",
};
export const revalidate = 3600;

const PER_PAGE = 30;
const KATEGORIEN = ["wohnung", "haus", "grundstueck", "gewerbe"] as const;

interface SearchParams {
  bundesland?: string;
  kategorie?: string;
  suche?: string;
  page?: string;
}

async function getArchiv(sp: SearchParams) {
  const page = Math.min(Math.max(1, parseInt(sp.page ?? "1") || 1), 200);
  const offset = (page - 1) * PER_PAGE;
  const suche = sp.suche ? clipSearchQuery(sp.suche) : "";

  const archivBedingung = eq(zvgListings.istAktiv, false);

  const suchBedingung = suche ? listingTextSearchSql(suche) : undefined;

  const where = and(
    archivBedingung,
    sp.bundesland ? bundeslandColumnMatches(zvgListings.bundesland, sp.bundesland) : undefined,
    sp.kategorie && isListingKategorie(sp.kategorie)
      ? listingTypeColumnMatches([sp.kategorie])
      : undefined,
    suchBedingung,
  );

  const [{ total }] = await db.select({ total: count() }).from(zvgListings).where(where);

  const rows = await db
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
      coverImageUrl: LISTING_COVER_IMAGE_SQL,
      lat: zvgListings.lat,
      lng: zvgListings.lng,
    })
    .from(zvgListings)
    .where(where)
    .orderBy(desc(zvgListings.terminDate), desc(zvgListings.id))
    .limit(PER_PAGE)
    .offset(offset);

  const now = new Date();
  return {
    listings: rows.map((listing) => ({
      ...listing,
      offline: !listing.terminDate || listing.terminDate > now,
    })) as ZvgListingCardData[],
    total,
    page,
    pages: Math.ceil(total / PER_PAGE),
  };
}

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ArchivPage({ searchParams }: PageProps) {
  const rawSp = await searchParams;
  const getStr = (k: string) =>
    (Array.isArray(rawSp[k]) ? (rawSp[k] as string[])[0] : rawSp[k]) as string | undefined;

  const sp: SearchParams = {
    bundesland: getStr("bundesland"),
    kategorie: getStr("kategorie"),
    suche: getStr("suche"),
    page: getStr("page"),
  };

  const { listings, total, page, pages } = await getArchiv(sp);

  const buildUrl = (params: Partial<SearchParams>) => {
    const merged = { ...sp, ...params };
    const q = new URLSearchParams();
    if (merged.bundesland) q.set("bundesland", merged.bundesland);
    if (merged.kategorie) q.set("kategorie", merged.kategorie);
    if (merged.suche) q.set("suche", merged.suche);
    if (merged.page && merged.page !== "1") q.set("page", merged.page);
    const qs = q.toString();
    return `/archiv${qs ? `?${qs}` : ""}`;
  };

  const hasFilter = !!(sp.bundesland || sp.kategorie || sp.suche);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Archiv"
        title="Inaktive Verfahren"
        description="Termin vorbei oder auf der Quelle nicht mehr geführt."
      />

      {/* Filter */}
      <form
        method="GET"
        action="/archiv"
        className="flex flex-wrap gap-3 items-end mb-6 p-4 rounded-[4px] border border-border bg-card"
      >
        {/* Bundesland */}
        <div className="flex flex-col gap-1.5 min-w-[160px]">
          <Label htmlFor="bl-select" className="text-xs">
            Bundesland
          </Label>
          <select
            id="bl-select"
            name="bundesland"
            defaultValue={sp.bundesland ?? ""}
            className="border border-input rounded-[4px] px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring/30"
          >
            <option value="">Alle Bundesländer</option>
            {BUNDESLAENDER.map((bl) => (
              <option key={bl.slug} value={bl.slug}>
                {bl.name}
              </option>
            ))}
          </select>
        </div>

        {/* Kategorie */}
        <div className="flex flex-col gap-1.5 min-w-[140px]">
          <Label htmlFor="kat-select" className="text-xs">
            Kategorie
          </Label>
          <select
            id="kat-select"
            name="kategorie"
            defaultValue={sp.kategorie ?? ""}
            className="border border-input rounded-[4px] px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring/30"
          >
            <option value="">Alle Kategorien</option>
            {KATEGORIEN.map((k) => (
              <option key={k} value={k}>
                {k.charAt(0).toUpperCase() + k.slice(1)}
              </option>
            ))}
          </select>
        </div>

        {/* Textsuche */}
        <div className="flex flex-col gap-1.5 min-w-[220px] flex-1">
          <Label htmlFor="suche-input" className="text-xs">
            Suche (Ort, Adresse, PLZ, Amtsgericht, Aktenzeichen)
          </Label>
          <Input
            id="suche-input"
            type="search"
            name="suche"
            placeholder="z. B. München, Musterstr. 1 …"
            defaultValue={sp.suche ?? ""}
          />
        </div>

        <div className="flex gap-2 items-center">
          <Button type="submit">Filtern</Button>
          {hasFilter && (
            <Button variant="outline" asChild>
              <Link href="/archiv">Zurücksetzen</Link>
            </Button>
          )}
        </div>
      </form>

      <ResultBar
        count={total}
        shown={listings.length}
        className="mb-4"
        trailing={
          pages > 1 ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              Seite {page} / {pages}
            </span>
          ) : null
        }
      />

      {listings.length > 0 ? (
        <HydratingListingGrid listings={listings} />
      ) : (
        <EmptyState
          message="Keine archivierten Verfahren für diese Filter."
          action={
            hasFilter ? (
              <Link href="/archiv" className="font-mono text-xs text-foreground hover:underline">
                Filter zurücksetzen
              </Link>
            ) : undefined
          }
        />
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-1.5 mt-8">
          {page > 1 && (
            <Button variant="outline" size="icon" asChild>
              <Link href={buildUrl({ page: String(page - 1) })}>
                <ChevronLeft className="size-4" />
              </Link>
            </Button>
          )}

          {Array.from({ length: Math.min(pages, 9) }, (_, i) => {
            let p: number;
            if (pages <= 9) {
              p = i + 1;
            } else if (page <= 5) {
              p = i + 1;
            } else if (page >= pages - 4) {
              p = pages - 8 + i;
            } else {
              p = page - 4 + i;
            }
            if (p < 1 || p > pages) return null;
            return (
              <Button key={p} variant={p === page ? "default" : "outline"} size="sm" asChild>
                <Link href={buildUrl({ page: String(p) })}>{p}</Link>
              </Button>
            );
          })}

          {page < pages && (
            <Button variant="outline" size="icon" asChild>
              <Link href={buildUrl({ page: String(page + 1) })}>
                <ChevronRight className="size-4" />
              </Link>
            </Button>
          )}
        </div>
      )}
    </PageShell>
  );
}
