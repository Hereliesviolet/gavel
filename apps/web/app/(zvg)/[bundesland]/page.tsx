import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { zvgListings } from "@/drizzle/schema";
import { eq, and, gte, lte, lt, count, asc, desc, inArray, isNotNull, sql } from "drizzle-orm";
import { isUsableZvgBundesland } from "@/lib/zvg-documents";
import { bundeslandColumnMatches, findBundesland } from "@/lib/bundesland";
import { parseListingKategorien } from "@/lib/kategorien";
import { LISTING_COVER_IMAGE_SQL } from "@/lib/listing-cover";
import { listingTypeColumnMatches } from "@/lib/listing-type-filter";
import { FilterPanelWrapper, MobileFilterSheet } from "@/components/zvg/filter-panel-wrapper";
import { ListingGrid } from "@/components/zvg/listing-grid";
import { favoritedListingIds } from "@/lib/favorite-write";
import { SortSelect } from "@/components/zvg/sort-select";
import { ZvgListingCardData } from "@/components/zvg/listing-card";
import { ViewToggle } from "@/components/zvg/view-toggle";
import type { MapPin } from "@/components/zvg/map-view";
import { parseUsableGeoPoint } from "@/lib/geo-point";
import {
  addZonedCalendarDays,
  exclusiveZonedCalendarHorizon,
  startOfZonedDay,
  visiblePageNumbers,
} from "@/lib/utils";
import { DEFAULT_TERMIN_HORIZON_DAYS, upcomingTerminSql } from "@/lib/termin-sql";
import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const PER_PAGE = 20;
const MAP_PIN_LIMIT = 2000;

interface PageProps {
  params: Promise<{ bundesland: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { bundesland } = await params;
  const bl = findBundesland(bundesland);
  if (!bl) return {};
  return {
    title: `Zwangsversteigerungen ${bl.name}`,
    description: `Aktuelle Zwangsversteigerungen in ${bl.name} – täglich aktualisiert.`,
  };
}

function listingQueryParts(bundesland: string, sp: Record<string, string | string[] | undefined>) {
  const getStr = (key: string) =>
    (Array.isArray(sp[key]) ? sp[key][0] : sp[key]) as string | undefined;
  const getArr = (key: string): string[] => {
    const v = sp[key];
    if (!v) return [];
    return Array.isArray(v) ? v : [v];
  };

  const page = Math.min(Math.max(parseInt(getStr("page") ?? "1") || 1, 1), 200);
  const sort = getStr("sort") ?? "neu_zuerst";

  // Bug-Fix (2026-07-04): Statt eines exakten eq()-Vergleichs wird die
  // Rohspalte normalisiert verglichen (siehe lib/bundesland.ts) - sonst
  // bleiben Schreibvarianten wie "baden-wuerttemberg" (mit Bindestrich)
  // gegenüber der kanonischen Slug-Form "badenwuerttemberg" unsichtbar,
  // obwohl sie zum selben Bundesland gehören.
  const conditions = [
    bundeslandColumnMatches(zvgListings.bundesland, bundesland),
    eq(zvgListings.istAktiv, true),
  ];

  const kategorien = parseListingKategorien(getArr("kategorie"));
  if (kategorien.length) {
    const typeMatch = listingTypeColumnMatches(kategorien);
    if (typeMatch) conditions.push(typeMatch);
  }

  const minPreis = parseInt(getStr("min_preis") ?? "");
  const maxPreis = parseInt(getStr("max_preis") ?? "");
  if (!isNaN(minPreis)) conditions.push(gte(zvgListings.verkehrswert, String(minPreis)));
  if (!isNaN(maxPreis)) conditions.push(lte(zvgListings.verkehrswert, String(maxPreis)));

  const minFlaeche = parseFloat(getStr("min_flaeche") ?? "");
  const maxFlaeche = parseFloat(getStr("max_flaeche") ?? "");
  if (!isNaN(minFlaeche)) conditions.push(gte(zvgListings.wohnflaecheM2, String(minFlaeche)));
  if (!isNaN(maxFlaeche)) conditions.push(lte(zvgListings.wohnflaecheM2, String(maxFlaeche)));

  // Bug-Fix (2026-07-04): "Termin im Zeitraum"-Slider (min_termin/max_termin,
  // Tage relativ zu heute) wurde von FilterPanelWrapper zwar in die URL
  // geschrieben, aber hier nie ausgewertet - die Terminspanne hatte dadurch
  // keinerlei Effekt auf die Trefferliste.
  const today = startOfZonedDay(new Date());

  const minTerminParsed = parseInt(getStr("min_termin") ?? "0");
  const maxTerminParsed = parseInt(getStr("max_termin") ?? String(DEFAULT_TERMIN_HORIZON_DAYS));
  const minTermin = Math.max(0, Number.isFinite(minTerminParsed) ? minTerminParsed : 0);
  const maxTermin = Number.isFinite(maxTerminParsed)
    ? maxTerminParsed
    : DEFAULT_TERMIN_HORIZON_DAYS;
  if (minTermin === 0) {
    conditions.push(upcomingTerminSql());
  } else {
    conditions.push(gte(zvgListings.terminDate, addZonedCalendarDays(today, minTermin)));
  }
  conditions.push(lt(zvgListings.terminDate, exclusiveZonedCalendarHorizon(maxTermin, today)));

  // Bug-Fix (2026-07-04): Die Status-Checkboxen ("Neu in 24h", "Termin <
  // 14 Tage", "Vermietet", "Denkmalschutz", "Mit KI-Analyse") übergaben
  // per FilterPanelWrapper einen "status"-Array-Parameter, den getListings
  // bisher komplett ignorierte (der frühere "nur_neue"-Parameter wurde von
  // keiner Komponente mehr gesendet und ist daher entfernt).
  const status = getArr("status");
  if (status.includes("neu24")) {
    conditions.push(gte(zvgListings.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)));
  }
  if (status.includes("vermietet")) conditions.push(eq(zvgListings.vermietet, true));
  if (status.includes("denkmalschutz")) conditions.push(eq(zvgListings.denkmalschutz, true));
  if (status.includes("termin14")) {
    conditions.push(upcomingTerminSql());
    conditions.push(lt(zvgListings.terminDate, exclusiveZonedCalendarHorizon(14, today)));
  }
  if (status.includes("ki")) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM zvg_ki_analyses WHERE listing_id = "zvg_listings"."id")`,
    );
  }

  const amtsgerichte = [
    ...new Set(
      getArr("amtsgericht")
        .map((value) => value.trim())
        .filter((value) => value.length > 0 && value.length <= 120),
    ),
  ].slice(0, 30);
  if (amtsgerichte.length) {
    conditions.push(inArray(zvgListings.amtsgericht, amtsgerichte));
  }

  const orderBy = {
    neu_zuerst: [desc(zvgListings.createdAt), desc(zvgListings.id)],
    termin_asc: [asc(zvgListings.terminDate), asc(zvgListings.id)],
    termin_desc: [desc(zvgListings.terminDate), desc(zvgListings.id)],
    preis_asc: [asc(zvgListings.verkehrswert), asc(zvgListings.id)],
    preis_desc: [desc(zvgListings.verkehrswert), desc(zvgListings.id)],
    flaeche_asc: [asc(zvgListings.wohnflaecheM2), asc(zvgListings.id)],
    flaeche_desc: [desc(zvgListings.wohnflaecheM2), desc(zvgListings.id)],
  }[sort] ?? [desc(zvgListings.createdAt), desc(zvgListings.id)];

  return { conditions, orderBy, page };
}

async function getListings(bundesland: string, sp: Record<string, string | string[] | undefined>) {
  const { conditions, orderBy, page } = listingQueryParts(bundesland, sp);

  const [{ total }] = await db
    .select({ total: count() })
    .from(zvgListings)
    .where(and(...conditions));

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
    .where(and(...conditions))
    .orderBy(...orderBy)
    .limit(PER_PAGE)
    .offset((page - 1) * PER_PAGE);

  return {
    listings: rows as ZvgListingCardData[],
    total,
    page,
    pages: Math.ceil(total / PER_PAGE),
  };
}

async function getMapPins(
  bundesland: string,
  sp: Record<string, string | string[] | undefined>,
): Promise<{ pins: MapPin[]; truncated: boolean }> {
  const { conditions, orderBy } = listingQueryParts(bundesland, sp);
  const rows = await db
    .select({
      id: zvgListings.id,
      slug: zvgListings.slug,
      bundesland: zvgListings.bundesland,
      typ: zvgListings.typ,
      verkehrswert: zvgListings.verkehrswert,
      lat: zvgListings.lat,
      lng: zvgListings.lng,
    })
    .from(zvgListings)
    .where(and(...conditions, isNotNull(zvgListings.lat), isNotNull(zvgListings.lng)))
    .orderBy(...orderBy)
    .limit(MAP_PIN_LIMIT + 1);

  const truncated = rows.length > MAP_PIN_LIMIT;
  const limited = truncated ? rows.slice(0, MAP_PIN_LIMIT) : rows;
  return {
    pins: limited.flatMap((l) => {
      const coords = parseUsableGeoPoint(l.lat, l.lng);
      if (!coords) return [];
      return [
        {
          id: l.id,
          lat: coords.lat,
          lng: coords.lng,
          verkehrswert: Number(l.verkehrswert) || 0,
          typ: l.typ ?? "Objekt",
          slug: l.slug,
          bundesland: l.bundesland,
        },
      ];
    }),
    truncated,
  };
}

async function getAmtsgerichte(
  bundesland: string,
  sp: Record<string, string | string[] | undefined>,
) {
  const { conditions } = listingQueryParts(bundesland, {
    ...sp,
    amtsgericht: undefined,
  });
  const rows = await db
    .selectDistinct({ amtsgericht: zvgListings.amtsgericht })
    .from(zvgListings)
    .where(and(...conditions, isNotNull(zvgListings.amtsgericht)))
    .orderBy(asc(zvgListings.amtsgericht))
    .limit(80);

  const seen = new Set<string>();
  const courts: Array<{ key: string; label: string }> = [];
  for (const row of rows) {
    const label = row.amtsgericht?.trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    courts.push({ key: label, label });
  }
  return courts;
}

export default async function BundeslandPage({ params, searchParams }: PageProps) {
  // zweite Verteidigungslinie zusätzlich zum
  // globalen Auth-Gate (proxy.ts) und app/layout.tsx - React Server
  // Components können unter Next.js grundsätzlich parallel zum
  // Eltern-Layout aufgelöst werden, ein Redirect im Layout garantiert daher
  // nicht zwingend, dass die DB-Query dieser Seite (private ZVG-/KI-Daten)
  // nie ausgeführt wird. Direkter, eigener Check hier schließt das.
  const session = await auth();
  const { bundesland } = await params;
  if (!session?.user?.id) {
    redirect(`/login?from=${isUsableZvgBundesland(bundesland) ? `/${bundesland}` : "/"}`);
  }

  const sp = await searchParams;

  const bl = findBundesland(bundesland);
  if (!bl) notFound();

  const [
    { listings, total, page, pages },
    { pins: mapPins, truncated: mapTruncated },
    amtsgerichte,
  ] = await Promise.all([
    getListings(bundesland, sp),
    getMapPins(bundesland, sp),
    getAmtsgerichte(bundesland, sp),
  ]);
  const favoritedIds = [
    ...(await favoritedListingIds(
      session.user.id,
      listings.map((listing) => listing.id),
    )),
  ];
  const sort = (Array.isArray(sp.sort) ? sp.sort[0] : sp.sort) ?? "neu_zuerst";

  const buildPageUrl = (p: number) => {
    const urlParams = new URLSearchParams();
    Object.entries(sp).forEach(([k, v]) => {
      if (k === "page") return;
      if (Array.isArray(v)) v.forEach((val) => urlParams.append(k, val));
      else if (v) urlParams.set(k, v);
    });
    if (p > 1) urlParams.set("page", String(p));
    const qs = urlParams.toString();
    return `/${bundesland}${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="max-w-[var(--page-max-width)] mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-sm text-muted-foreground mb-6">
        <Link href="/" className="hover:text-primary">
          Deutschland
        </Link>
        <ChevronRight className="size-3.5" />
        <span className="text-foreground font-medium">{bl.name}</span>
      </nav>

      <div className="flex gap-8">
        {/* Filter Sidebar */}
        <div className="hidden lg:block w-64 shrink-0">
          <div className="sticky top-[88px]">
            <Suspense>
              <FilterPanelWrapper amtsgerichte={amtsgerichte} />
            </Suspense>
          </div>
        </div>

        {/* Main */}
        <div className="flex-1 min-w-0">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{total.toLocaleString("de-DE")}</span>{" "}
              Objekte in {bl.name}
              {mapTruncated
                ? ` · Karte zeigt ${MAP_PIN_LIMIT.toLocaleString("de-DE")} geokodierte Treffer`
                : ""}
            </p>
            <div className="flex items-center gap-2">
              <Suspense>
                <div className="lg:hidden">
                  <MobileFilterSheet amtsgerichte={amtsgerichte} />
                </div>
              </Suspense>
              <SortSelect currentSort={sort} />
            </div>
          </div>

          {/* Grid + Kartenansicht via Toggle */}
          <ViewToggle pins={mapPins}>
            <Suspense fallback={<ListingGridSkeleton />}>
              <ListingGrid listings={listings} favoritedIds={favoritedIds} />
            </Suspense>
          </ViewToggle>

          {/* Pagination */}
          {pages > 1 && (
            <div className="flex items-center justify-center gap-1 mt-8">
              {page > 1 && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={buildPageUrl(page - 1)}>← Zurück</Link>
                </Button>
              )}
              {visiblePageNumbers(page, pages, 7).map((p) => (
                <Button key={p} variant={p === page ? "default" : "outline"} size="sm" asChild>
                  <Link href={buildPageUrl(p)}>{p}</Link>
                </Button>
              ))}
              {page < pages && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={buildPageUrl(page + 1)}>Weiter →</Link>
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ListingGridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="aspect-video w-full rounded-[4px]" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-full" />
        </div>
      ))}
    </div>
  );
}
