import { cache } from "react";
import { db } from "@/lib/db";
import { zvgAuctionEvents, zvgKiAnalyses, zvgListings } from "@/drizzle/schema";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  isNotNull,
  lt,
  lte,
  ne,
  or,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";
import {
  cashflowYieldFuerZeile,
  computeTerminTage,
  deduplicatePicks,
  hasHeroCaution,
  isDiscoveryCandidate,
  isExcludedFromHero,
  rowToInvestorPick,
  selectDiscoveryStrategy,
  selectHeroPick,
  selectWildcardPick,
  type InvestorPeriod,
  type InvestorPick,
  type InvestorPickRow,
  type PickStrategy,
} from "@/lib/investor-picks";
import type { Datenreife } from "@/lib/investor-signals";
import type { InvestorProfile } from "@/lib/investor-profile";
import { addZonedCalendarDays, exclusiveZonedCalendarHorizon, startOfZonedDay } from "@/lib/utils";
import { upcomingTerminSql } from "@/lib/termin-sql";
import type { FixFlipMassnahme } from "@/components/zvg/detail/ki-sections/investment-fixflip";
import {
  enrichEinstiegPick,
  EINSTIEG_MAX_VW,
  EINSTIEG_MIN_VW,
  passesEinstiegCriteria,
} from "@/lib/einstieg-picks";
import { getMarketStats } from "@/lib/market-stats";
import { bundeslandColumnMatches } from "@/lib/bundesland";
import {
  listingTypeColumnMatches,
  marktKategorieSql,
  mikromarktSql,
  peerKategorieSql,
} from "@/lib/listing-type-filter";
import {
  intersectFinderBundeslaender,
  matchesInvestorProfile,
  selectDeskPickStrategy,
} from "@/lib/investor-profile-match";
import {
  applyPreset,
  buildFinderWhere,
  FIX_FLIP_BASIS_SQL,
  finderDiscountPct,
  isTerminWithinDays,
  isZeitnahTermin,
  pickMeetsCashflowMin,
  ANTI_SIGNAL_SQL,
  MAX_FINDER_CANDIDATES,
  MAX_FINDER_LIMIT,
  MAX_FINDER_OFFSET,
  ZEITNAH_MAX_DAYS,
  type FinderFilters,
} from "@/lib/investor-finder";
import { buildPeerBenchmark, type PeerBenchmark } from "@/lib/investor-benchmarks";
import { marketReference } from "@/drizzle/schema/markt";
import {
  listingKategorieFuerMarkt,
  listingKategorieFuerPeer,
  MARKTREFERENZ_MAX_ALTER_TAGE,
  MARKTREFERENZ_MIN_STICHPROBE,
  mikromarktAusPlz,
  referenzSchluessel,
  type Angebotstyp,
  type Marktreferenz,
} from "@/lib/market-reference";
import { LISTING_COVER_IMAGE_SQL } from "@/lib/listing-cover";

const COVER_IMAGE_SQL = LISTING_COVER_IMAGE_SQL;

/** Anzahl unterschiedlicher Termine — ab zwei liegt ein Wiederholungstermin vor. */
const TERMIN_ANZAHL_SQL = sql<string>`(
  SELECT count(DISTINCT termin_date) FROM zvg_auction_events
  WHERE listing_id = "zvg_listings"."id" AND termin_date IS NOT NULL
)`;

/** Verkehrswert der ersten Beobachtung, für das Reduktionssignal. */
const VERKEHRSWERT_ERST_SQL = sql<string | null>`(
  SELECT verkehrswert FROM zvg_auction_events
  WHERE listing_id = "zvg_listings"."id" AND verkehrswert IS NOT NULL
  ORDER BY erfasst_am ASC, id ASC
  LIMIT 1
)`;

/**
 * Geringstes Gebot aus der zuletzt gelesenen Terminsbestimmung. NULL heißt
 * unbekannt; das Underwriting weicht dann sichtbar auf ein Referenzgebot aus,
 * statt eine Rechtstatsache vorzutäuschen.
 */
const GERINGSTES_GEBOT_SQL = sql<string | null>`(
  SELECT e.geringstes_gebot FROM zvg_auction_events e
  WHERE e.listing_id = "zvg_listings"."id"
    AND e.geringstes_gebot IS NOT NULL
    AND (e.termin_date AT TIME ZONE 'Europe/Berlin')::date
      IS NOT DISTINCT FROM ("zvg_listings"."termin_date" AT TIME ZONE 'Europe/Berlin')::date
  ORDER BY e.erfasst_am DESC, e.id DESC
  LIMIT 1
)`;

/** Kapitalwert bestehenbleibender Rechte; 0 ist eine Aussage, NULL nicht. */
const BESTEHENDE_RECHTE_SQL = sql<string | null>`(
  SELECT e.bestehende_rechte_eur FROM zvg_auction_events e
  WHERE e.listing_id = "zvg_listings"."id"
    AND e.bestehende_rechte_eur IS NOT NULL
    AND (e.termin_date AT TIME ZONE 'Europe/Berlin')::date
      IS NOT DISTINCT FROM ("zvg_listings"."termin_date" AT TIME ZONE 'Europe/Berlin')::date
  ORDER BY e.erfasst_am DESC, e.id DESC
  LIMIT 1
)`;

const BILD_ANZAHL_SQL = sql<string>`(
  SELECT count(*) FROM zvg_images WHERE listing_id = "zvg_listings"."id"
)`;

const PREIS_PRO_M2_SQL = sql<number | null>`(
  CASE
    WHEN ${zvgListings.kategorie} = 'gewerbe'
      AND ${zvgListings.nutzflaecheM2} IS NOT NULL
      AND ${zvgListings.nutzflaecheM2}::numeric > 0
      AND ${zvgListings.verkehrswert} IS NOT NULL
    THEN (${zvgListings.verkehrswert}::numeric / ${zvgListings.nutzflaecheM2}::numeric)
    WHEN ${zvgListings.wohnflaecheM2} IS NOT NULL
      AND ${zvgListings.wohnflaecheM2}::numeric > 0
      AND ${zvgListings.verkehrswert} IS NOT NULL
    THEN (${zvgListings.verkehrswert}::numeric / ${zvgListings.wohnflaecheM2}::numeric)
    ELSE NULL
  END
)`.mapWith(Number);

const MIKROMARKT_SQL = mikromarktSql();

const MARKTREFERENZ_BELASTBAR_SQL = sql`(
  ref.stichprobe >= ${MARKTREFERENZ_MIN_STICHPROBE}
  AND ref.median_eur_m2 > 0
  AND (
    ref.stand IS NULL
    OR (
      (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Berlin')::date
      - (ref.stand AT TIME ZONE 'Europe/Berlin')::date
    ) <= ${MARKTREFERENZ_MAX_ALTER_TAGE}
  )
)`;

const MARKTLUECKE_SQL = sql`(
  1 - ${PREIS_PRO_M2_SQL} / ref.median_eur_m2::numeric
)`;

const CASHFLOW_YIELD_SQL = sql<number | null>`(
  CASE
    WHEN ${zvgKiAnalyses.moeglicherKaltmiete} IS NOT NULL
      AND ${zvgKiAnalyses.moeglicherKaltmiete}::numeric > 0
      AND ${zvgListings.verkehrswert} IS NOT NULL
      AND ${zvgListings.verkehrswert}::numeric > 0
    THEN (
      (${zvgKiAnalyses.moeglicherKaltmiete}::numeric - COALESCE(${zvgKiAnalyses.hausgeld}::numeric, 0))
      * 12 / ${zvgListings.verkehrswert}::numeric * 100
    )
    ELSE NULL
  END
)`.mapWith(Number);

type MedianLookup = {
  byCategoryBundesland: Map<string, PeerBenchmark>;
};

const MAX_ACTIVE_INVESTOR_CANDIDATES = 2_000;

/**
 * Mit React.cache() umschlossen (P-01): fetchM2Medians() führt eine teure
 * percentile_cont-Aggregatquery über die aktive, qualitätsgeprüfte
 * zvg_listings-Teilmenge aus.
 * Ohne Request-Level-Memoization ruft z.B. /investor/page.tsx dieselbe
 * Funktion pro Seitenaufruf bis zu 17x mit identischem Ergebnis auf.
 */
const fetchM2Medians = cache(async (): Promise<MedianLookup> => {
  const baseWhere = and(
    eq(zvgListings.istAktiv, true),
    eq(zvgListings.needsReview, false),
    isNotNull(zvgListings.verkehrswert),
    isNotNull(zvgListings.wohnflaecheM2),
    gte(zvgListings.verkehrswert, sql`1000`),
    gte(zvgListings.wohnflaecheM2, sql`5`),
    lte(zvgListings.wohnflaecheM2, sql`10000`),
    gte(
      sql`${zvgListings.verkehrswert}::numeric / NULLIF(${zvgListings.wohnflaecheM2}::numeric, 0)`,
      sql`100`,
    ),
    lte(
      sql`${zvgListings.verkehrswert}::numeric / NULLIF(${zvgListings.wohnflaecheM2}::numeric, 0)`,
      sql`50000`,
    ),
  );

  const peerKategorie = peerKategorieSql();
  const grouped = await db
    .select({
      kategorie: peerKategorie,
      bundesland: zvgListings.bundesland,
      median: sql<number>`percentile_cont(0.5) WITHIN GROUP (
        ORDER BY ${zvgListings.verkehrswert}::numeric / ${zvgListings.wohnflaecheM2}::numeric
      )`.mapWith(Number),
      p25: sql<number>`percentile_cont(0.25) WITHIN GROUP (
        ORDER BY ${zvgListings.verkehrswert}::numeric / ${zvgListings.wohnflaecheM2}::numeric
      )`.mapWith(Number),
      p75: sql<number>`percentile_cont(0.75) WITHIN GROUP (
        ORDER BY ${zvgListings.verkehrswert}::numeric / ${zvgListings.wohnflaecheM2}::numeric
      )`.mapWith(Number),
      sampleSize: count(),
    })
    .from(zvgListings)
    .innerJoin(zvgKiAnalyses, eq(zvgKiAnalyses.listingId, zvgListings.id))
    .where(baseWhere)
    .groupBy(peerKategorie, zvgListings.bundesland);

  const byCategoryBundesland = new Map<string, PeerBenchmark>();
  for (const row of grouped) {
    if (row.median == null) continue;
    byCategoryBundesland.set(
      `${row.kategorie ?? "other"}:${row.bundesland}`,
      buildPeerBenchmark({
        medianEurM2: row.median,
        p25EurM2: row.p25,
        p75EurM2: row.p75,
        sampleSize: row.sampleSize,
        scope: "category_state",
      }),
    );
  }

  return { byCategoryBundesland };
});

/**
 * Angebotspreis-Niveau je Mikromarkt aus den geernteten Vergleichsangeboten.
 * Gleiches Memoization-Muster wie fetchM2Medians: eine Investor-Seite baut
 * hunderte Picks, die Referenz ändert sich innerhalb eines Requests nicht.
 */
const fetchMarktreferenzen = cache(async (): Promise<Map<string, Marktreferenz>> => {
  const zeilen = await db
    .select({
      mikromarkt: marketReference.mikromarkt,
      kategorie: marketReference.kategorie,
      angebotstyp: marketReference.angebotstyp,
      stichprobe: marketReference.stichprobe,
      medianEurM2: marketReference.medianEurM2,
      p25EurM2: marketReference.p25EurM2,
      p75EurM2: marketReference.p75EurM2,
      stand: marketReference.stand,
    })
    .from(marketReference);

  const referenzen = new Map<string, Marktreferenz>();
  for (const zeile of zeilen) {
    const median = zahl(zeile.medianEurM2);
    if (median == null || median <= 0) continue;
    const angebotstyp = zeile.angebotstyp as Angebotstyp;
    referenzen.set(referenzSchluessel(zeile.mikromarkt, zeile.kategorie, angebotstyp), {
      mikromarkt: zeile.mikromarkt,
      kategorie: zeile.kategorie,
      angebotstyp,
      medianEurM2: median,
      p25EurM2: zahl(zeile.p25EurM2),
      p75EurM2: zahl(zeile.p75EurM2),
      stichprobe: Number(zeile.stichprobe ?? 0),
      stand: zeile.stand,
    });
  }
  return referenzen;
});

function resolveMarktreferenz(
  referenzen: Map<string, Marktreferenz>,
  plz: string | null,
  kategorie: string | null,
  angebotstyp: Angebotstyp,
): Marktreferenz | null {
  const mikromarkt = mikromarktAusPlz(plz);
  if (!mikromarkt || !kategorie) return null;
  return referenzen.get(referenzSchluessel(mikromarkt, kategorie, angebotstyp)) ?? null;
}

export async function fetchPeerBenchmark(
  kategorie: string | null,
  bundesland: string,
): Promise<PeerBenchmark> {
  const medians = await fetchM2Medians();
  return resolveBenchmark(medians, kategorie, bundesland);
}

/** Marktreferenz für eine einzelne Objektseite. */
export async function fetchMarktreferenzFuerObjekt(
  plz: string | null,
  kategorie: string | null,
  angebotstyp: Angebotstyp,
): Promise<Marktreferenz | null> {
  const referenzen = await fetchMarktreferenzen();
  return resolveMarktreferenz(referenzen, plz, kategorie, angebotstyp);
}

export interface Terminsdaten {
  geringstesGebotEur: number | null;
  bestehendeRechteEur: number | null;
  bestehendeRechteText: string | null;
}

/**
 * Gelesene Terminsbestimmung für eine einzelne Objektseite. Fehlt sie, gibt es
 * überall null — die Oberfläche schreibt dann "nicht bekannt", statt wie früher
 * verkehrswert * 0,75 als gerichtliches Mindestgebot auszuweisen.
 */
export async function fetchTerminsdaten(listingId: string): Promise<Terminsdaten> {
  const rows = await db
    .select({
      geringstesGebot: zvgAuctionEvents.geringstesGebot,
      bestehendeRechteEur: zvgAuctionEvents.bestehendeRechteEur,
      bestehendeRechteText: zvgAuctionEvents.bestehendeRechteText,
    })
    .from(zvgAuctionEvents)
    .innerJoin(zvgListings, eq(zvgAuctionEvents.listingId, zvgListings.id))
    .where(
      and(
        eq(zvgAuctionEvents.listingId, listingId),
        sql`(${zvgAuctionEvents.terminDate} AT TIME ZONE 'Europe/Berlin')::date
          IS NOT DISTINCT FROM (${zvgListings.terminDate} AT TIME ZONE 'Europe/Berlin')::date`,
      ),
    )
    .orderBy(desc(zvgAuctionEvents.erfasstAm), desc(zvgAuctionEvents.id));

  const zahlOderNull = (wert: string | null | undefined) =>
    wert == null ? null : Number.isFinite(Number(wert)) ? Number(wert) : null;

  return {
    geringstesGebotEur:
      zahlOderNull(rows.find((r) => r.geringstesGebot != null)?.geringstesGebot) ?? null,
    bestehendeRechteEur:
      zahlOderNull(rows.find((r) => r.bestehendeRechteEur != null)?.bestehendeRechteEur) ?? null,
    bestehendeRechteText:
      rows.find((r) => r.bestehendeRechteText != null)?.bestehendeRechteText ?? null,
  };
}

function resolveBenchmark(
  medians: MedianLookup,
  kategorie: string | null,
  bundesland: string,
): PeerBenchmark {
  const key = `${kategorie ?? "other"}:${bundesland}`;
  return (
    medians.byCategoryBundesland.get(key) ??
    buildPeerBenchmark({
      scope: "none",
      sampleSize: 0,
    })
  );
}

function notAbratenFilter() {
  return or(isNull(zvgKiAnalyses.investmentScore), ne(zvgKiAnalyses.investmentScore, "abraten"));
}

type SignalSpalten = {
  terminAnzahl?: string | number | null;
  verkehrswertErst?: string | number | null;
  bildAnzahl?: string | number | null;
  geringstesGebot?: string | number | null;
  bestehendeRechte?: string | number | null;
};

function zahl(wert: string | number | null | undefined): number | null {
  if (wert == null) return null;
  const parsed = Number(wert);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapQueryRow(
  row: {
    listing: typeof zvgListings.$inferSelect;
    ki: typeof zvgKiAnalyses.$inferSelect;
    coverImageUrl: string | null;
    preisProM2: number | null;
    cashflowYieldPct: number | null;
  } & SignalSpalten,
  medians: MedianLookup,
  marktreferenzen: Map<string, Marktreferenz>,
): InvestorPickRow {
  const massnahmen = (row.ki.fixFlipMassnahmen as FixFlipMassnahme[] | null) ?? [];
  const marktKategorie = listingKategorieFuerMarkt(row.listing.kategorie, row.listing.typ);
  const peerKategorie = listingKategorieFuerPeer(row.listing.kategorie, row.listing.typ);
  const verkehrswertAktuell = zahl(row.listing.verkehrswert);
  const mapped: InvestorPickRow = {
    historie: {
      terminAnzahl: zahl(row.terminAnzahl) ?? 0,
      verkehrswertErst: zahl(row.verkehrswertErst) ?? verkehrswertAktuell,
      verkehrswertAktuell,
    },
    praesentation: {
      bildAnzahl: zahl(row.bildAnzahl) ?? 0,
      beschreibungZeichen: row.listing.beschreibung?.length ?? 0,
      hatExpose: row.listing.exposeUrl != null,
      erfasstAm: row.listing.createdAt,
    },
    listing: {
      id: row.listing.id,
      slug: row.listing.slug,
      bundesland: row.listing.bundesland,
      bundeslandName: row.listing.bundeslandName,
      typ: row.listing.typ,
      kategorie: row.listing.kategorie,
      adresse: row.listing.adresse,
      ort: row.listing.ort,
      verkehrswert: row.listing.verkehrswert,
      wohnflaecheM2: row.listing.wohnflaecheM2,
      zimmer: row.listing.zimmer,
      terminDate: row.listing.terminDate,
      amtsgericht: row.listing.amtsgericht,
      plz: row.listing.plz,
      createdAt: row.listing.createdAt,
      needsReview: row.listing.needsReview,
      dataQualityFlags: row.listing.dataQualityFlags,
    },
    ki: {
      investmentScore: row.ki.investmentScore,
      investmentScoreBegruendung: row.ki.investmentScoreBegruendung,
      zusammenfassung: null,
      fixFlipMassnahmen: massnahmen,
      moeglicherKaltmiete: row.ki.moeglicherKaltmiete,
      hausgeld: row.ki.hausgeld,
      risikenInvestor: (row.ki.risikenInvestor as string[] | null) ?? [],
      fixFlipGesamtkostenMinEur: row.ki.fixFlipGesamtkostenMinEur,
      fixFlipGesamtkostenMaxEur: row.ki.fixFlipGesamtkostenMaxEur,
      arvMinEur: row.ki.arvMinEur,
      arvMaxEur: row.ki.arvMaxEur,
      arvKonfidenz: row.ki.arvKonfidenz,
      arvBegruendung: row.ki.arvBegruendung,
      innenbesichtigung: row.ki.innenbesichtigung,
      holdingMonate: row.ki.holdingMonate,
      analyzedAt: row.ki.analyzedAt,
    },
    geringstesGebotEur: zahl(row.geringstesGebot),
    bestehendeRechteEur: zahl(row.bestehendeRechte),
    rechteVerifiziert: zahl(row.bestehendeRechte) != null,
    coverImageUrl: row.coverImageUrl,
    preisProM2: row.preisProM2,
    cashflowYieldPct: null,
    terminTage: computeTerminTage(row.listing.terminDate),
    kategorieMedianM2: resolveBenchmark(medians, peerKategorie, row.listing.bundesland).medianEurM2,
    benchmark: resolveBenchmark(medians, peerKategorie, row.listing.bundesland),
    marktreferenzKauf: resolveMarktreferenz(
      marktreferenzen,
      row.listing.plz,
      marktKategorie,
      "kauf",
    ),
    marktreferenzMiete: resolveMarktreferenz(
      marktreferenzen,
      row.listing.plz,
      marktKategorie,
      "miete",
    ),
  };
  mapped.cashflowYieldPct = cashflowYieldFuerZeile(mapped);
  return mapped;
}

export function isListingInInvestorPeriod(
  listing: { createdAt: Date | null; terminDate: Date | null },
  period: InvestorPeriod,
  now = new Date(),
): boolean {
  const horizon = period === "week" ? 7 : 30;
  const periodStart = addZonedCalendarDays(startOfZonedDay(now), -horizon);

  const isNew = Boolean(listing.createdAt && listing.createdAt >= periodStart);
  const isUpcoming = isAuctionInInvestorPeriod(listing.terminDate, period, now);
  return isNew || isUpcoming;
}

export function isAuctionInInvestorPeriod(
  terminDate: Date | null,
  period: InvestorPeriod,
  now = new Date(),
): boolean {
  return isTerminWithinDays(terminDate, period === "week" ? 7 : 30, now);
}

function profileListingConditions(profileInput?: Partial<InvestorProfile> | null) {
  const lock = intersectFinderBundeslaender(undefined, profileInput?.regions);
  if (lock.kind === "none") return { empty: true as const, extras: [] };
  const extras = [];
  if (lock.kind === "slugs") {
    extras.push(
      or(...lock.slugs.map((bl) => bundeslandColumnMatches(zvgListings.bundesland, bl)))!,
    );
  }
  const types = profileInput?.propertyTypes?.filter(Boolean) ?? [];
  if (types.length) {
    const typeMatch = listingTypeColumnMatches(types);
    if (typeMatch) extras.push(typeMatch);
  }
  return { empty: false as const, extras };
}

function sortPicksByScore(picks: InvestorPick[]): InvestorPick[] {
  return [...picks].sort((a, b) => {
    if (a.metrics.investmentScore === "abraten" && b.metrics.investmentScore !== "abraten") {
      return 1;
    }
    if (b.metrics.investmentScore === "abraten" && a.metrics.investmentScore !== "abraten") {
      return -1;
    }
    return b.chance.wert - a.chance.wert;
  });
}

const fetchStrategyRows = cache(async function fetchStrategyRows(
  strategy: Exclude<PickStrategy, "all" | "wildcard">,
  limit: number,
  profileInput?: Partial<InvestorProfile> | null,
): Promise<InvestorPickRow[]> {
  const profileFilter = profileListingConditions(profileInput);
  if (profileFilter.empty) return [];

  const [medians, marktreferenzen] = await Promise.all([fetchM2Medians(), fetchMarktreferenzen()]);
  const jetzt = new Date();

  const baseSelect = {
    listing: zvgListings,
    ki: zvgKiAnalyses,
    coverImageUrl: COVER_IMAGE_SQL,
    terminAnzahl: TERMIN_ANZAHL_SQL,
    verkehrswertErst: VERKEHRSWERT_ERST_SQL,
    geringstesGebot: GERINGSTES_GEBOT_SQL,
    bestehendeRechte: BESTEHENDE_RECHTE_SQL,
    bildAnzahl: BILD_ANZAHL_SQL,
    preisProM2: PREIS_PRO_M2_SQL,
    cashflowYieldPct: CASHFLOW_YIELD_SQL,
  };

  let rows: Array<{
    listing: typeof zvgListings.$inferSelect;
    ki: typeof zvgKiAnalyses.$inferSelect;
    coverImageUrl: string | null;
    preisProM2: number | null;
    cashflowYieldPct: number | null;
  }> = [];

  if (strategy === "fix_flip") {
    rows = await db
      .select(baseSelect)
      .from(zvgListings)
      .innerJoin(zvgKiAnalyses, eq(zvgKiAnalyses.listingId, zvgListings.id))
      .where(
        and(
          eq(zvgListings.istAktiv, true),
          eq(zvgListings.needsReview, false),
          upcomingTerminSql(),
          FIX_FLIP_BASIS_SQL,
          ...profileFilter.extras,
        ),
      )
      .orderBy(desc(zvgKiAnalyses.analyzedAt), desc(zvgListings.id))
      .limit(limit);
  } else if (strategy === "buy_hold") {
    rows = await db
      .select(baseSelect)
      .from(zvgListings)
      .innerJoin(zvgKiAnalyses, eq(zvgKiAnalyses.listingId, zvgListings.id))
      .where(
        and(
          eq(zvgListings.istAktiv, true),
          eq(zvgListings.needsReview, false),
          upcomingTerminSql(),
          notAbratenFilter(),
          ...profileFilter.extras,
        ),
      )
      .orderBy(desc(zvgKiAnalyses.analyzedAt), desc(zvgListings.id))
      .limit(limit);
  } else if (strategy === "unter_markt") {
    const rawRows = await db
      .select(baseSelect)
      .from(zvgListings)
      .innerJoin(zvgKiAnalyses, eq(zvgKiAnalyses.listingId, zvgListings.id))
      .innerJoin(
        sql`market_reference ref`,
        sql`ref.mikromarkt = ${MIKROMARKT_SQL}
          AND ref.kategorie = ${marktKategorieSql()}
          AND ref.angebotstyp = 'kauf'`,
      )
      .where(
        and(
          eq(zvgListings.istAktiv, true),
          eq(zvgListings.needsReview, false),
          upcomingTerminSql(),
          isNotNull(zvgListings.verkehrswert),
          isNotNull(zvgListings.wohnflaecheM2),
          gt(zvgListings.wohnflaecheM2, sql`0`),
          gt(zvgListings.verkehrswert, sql`0`),
          sql`${PREIS_PRO_M2_SQL} > 0`,
          MARKTREFERENZ_BELASTBAR_SQL,
          sql`${MARKTLUECKE_SQL} > 0`,
          ...profileFilter.extras,
        ),
      )
      .orderBy(desc(MARKTLUECKE_SQL), asc(zvgListings.id))
      .limit(limit);

    return rawRows
      .map((row) => mapQueryRow(row, medians, marktreferenzen))
      .filter((row) => isDiscoveryCandidate(row, "unter_markt", profileInput));
  } else if (strategy === "zeitnah") {
    rows = await db
      .select(baseSelect)
      .from(zvgListings)
      .innerJoin(zvgKiAnalyses, eq(zvgKiAnalyses.listingId, zvgListings.id))
      .where(
        and(
          eq(zvgListings.istAktiv, true),
          eq(zvgListings.needsReview, false),
          isNotNull(zvgListings.terminDate),
          upcomingTerminSql(),
          lt(zvgListings.terminDate, exclusiveZonedCalendarHorizon(ZEITNAH_MAX_DAYS, jetzt)),
          ...profileFilter.extras,
        ),
      )
      .orderBy(asc(zvgListings.terminDate), asc(zvgListings.id))
      .limit(limit);
  }

  return rows
    .map((row) => mapQueryRow(row, medians, marktreferenzen))
    .filter((row) => isDiscoveryCandidate(row, strategy, profileInput))
    .filter((row) => strategy !== "zeitnah" || isZeitnahTermin(row.listing.terminDate));
});

/**
 * Alle aktiven, nicht zur Prüfung markierten Objekte mit KI-Analyse, ohne
 * Strategiefilter. Entspricht der Finder-Grundgesamtheit.
 */
export async function fetchAllActiveInvestorRows(): Promise<InvestorPickRow[]> {
  const [medians, marktreferenzen] = await Promise.all([fetchM2Medians(), fetchMarktreferenzen()]);
  const rows = await db
    .select({
      listing: zvgListings,
      ki: zvgKiAnalyses,
      coverImageUrl: COVER_IMAGE_SQL,
      terminAnzahl: TERMIN_ANZAHL_SQL,
      verkehrswertErst: VERKEHRSWERT_ERST_SQL,
      geringstesGebot: GERINGSTES_GEBOT_SQL,
      bestehendeRechte: BESTEHENDE_RECHTE_SQL,
      bildAnzahl: BILD_ANZAHL_SQL,
      preisProM2: PREIS_PRO_M2_SQL,
      cashflowYieldPct: CASHFLOW_YIELD_SQL,
    })
    .from(zvgListings)
    .innerJoin(zvgKiAnalyses, eq(zvgKiAnalyses.listingId, zvgListings.id))
    .where(
      and(eq(zvgListings.istAktiv, true), eq(zvgListings.needsReview, false), upcomingTerminSql()),
    )
    .limit(MAX_ACTIVE_INVESTOR_CANDIDATES);

  return rows.map((row) => mapQueryRow(row, medians, marktreferenzen));
}

export async function fetchInvestorPicks(
  period: InvestorPeriod = "week",
  strategy: PickStrategy = "all",
  limit = 20,
  profileInput?: Partial<InvestorProfile> | null,
): Promise<InvestorPick[]> {
  const strategies: Exclude<PickStrategy, "all" | "wildcard">[] =
    strategy === "all"
      ? ["fix_flip", "buy_hold", "unter_markt", "zeitnah"]
      : strategy === "wildcard"
        ? ["fix_flip", "buy_hold", "unter_markt"]
        : [strategy];

  const rowBatches = await Promise.all(
    strategies.map((s) => fetchStrategyRows(s, MAX_ACTIVE_INVESTOR_CANDIDATES, profileInput)),
  );

  const picks: InvestorPick[] = [];

  for (let i = 0; i < strategies.length; i++) {
    const strat = strategies[i];
    for (const row of rowBatches[i]) {
      if (!matchesInvestorProfile(row, profileInput)) continue;
      const isInPeriod =
        strat === "zeitnah"
          ? isZeitnahTermin(row.listing.terminDate)
          : isListingInInvestorPeriod(
              {
                createdAt: row.listing.createdAt,
                terminDate: row.listing.terminDate,
              },
              period,
            );
      if (!isInPeriod) {
        continue;
      }
      picks.push(rowToInvestorPick(row, strat, profileInput));
    }
  }

  let sorted = sortPicksByScore(picks);

  if (strategy === "wildcard") {
    const used = new Set<string>();
    const wildcard = selectWildcardPick(sorted, used);
    return wildcard ? [wildcard] : [];
  }

  if (strategy === "all") {
    sorted = deduplicatePicks(sorted);
  }

  return sorted.slice(0, limit);
}

export async function fetchInvestmentCoverage() {
  const coverageWhere = and(eq(zvgListings.istAktiv, true), eq(zvgListings.needsReview, false));

  const [totalRow] = await db.select({ count: count() }).from(zvgListings).where(coverageWhere);

  const [mitKiRow] = await db
    .select({ count: count() })
    .from(zvgListings)
    .innerJoin(zvgKiAnalyses, eq(zvgKiAnalyses.listingId, zvgListings.id))
    .where(coverageWhere);

  const [mitInvestmentRow] = await db
    .select({ count: count() })
    .from(zvgListings)
    .innerJoin(zvgKiAnalyses, eq(zvgKiAnalyses.listingId, zvgListings.id))
    .where(and(coverageWhere, isNotNull(zvgKiAnalyses.investmentScore)));

  const [mitFlipRow] = await db
    .select({ count: count() })
    .from(zvgListings)
    .innerJoin(zvgKiAnalyses, eq(zvgKiAnalyses.listingId, zvgListings.id))
    .where(and(coverageWhere, isNotNull(zvgKiAnalyses.arvMinEur)));

  const total = totalRow?.count ?? 0;
  const mitKi = mitKiRow?.count ?? 0;

  return {
    total,
    mitKi,
    mitInvestmentScore: mitInvestmentRow?.count ?? 0,
    mitFlipScore: mitFlipRow?.count ?? 0,
    pctMitInvestment: mitKi > 0 ? Math.round(((mitInvestmentRow?.count ?? 0) / mitKi) * 100) : 0,
    pctMitKi: total > 0 ? Math.round((mitKi / total) * 100) : 0,
  };
}

export async function fetchFinderPicks(
  filters: FinderFilters = {},
  profileInput?: Partial<InvestorProfile> | null,
) {
  const f = applyPreset(filters);
  const regionLock = intersectFinderBundeslaender(f.bundesland, profileInput?.regions);
  if (regionLock.kind === "none") {
    return { picks: [], total: 0, regionConflict: true };
  }
  const queryFilters = {
    ...(regionLock.kind === "slugs" ? { ...f, bundesland: regionLock.slugs } : f),
    ...(profileInput?.propertyTypes?.length ? { objektarten: profileInput.propertyTypes } : {}),
  };
  const limit = Math.min(Math.max(f.limit ?? 20, 1), MAX_FINDER_LIMIT);
  const offset = Math.min(Math.max(f.offset ?? 0, 0), MAX_FINDER_OFFSET);
  const [medians, marktreferenzen] = await Promise.all([fetchM2Medians(), fetchMarktreferenzen()]);

  const rows = await db
    .select({
      listing: zvgListings,
      ki: zvgKiAnalyses,
      coverImageUrl: COVER_IMAGE_SQL,
      terminAnzahl: TERMIN_ANZAHL_SQL,
      verkehrswertErst: VERKEHRSWERT_ERST_SQL,
      geringstesGebot: GERINGSTES_GEBOT_SQL,
      bestehendeRechte: BESTEHENDE_RECHTE_SQL,
      bildAnzahl: BILD_ANZAHL_SQL,
      preisProM2: PREIS_PRO_M2_SQL,
      cashflowYieldPct: CASHFLOW_YIELD_SQL,
    })
    .from(zvgListings)
    .innerJoin(zvgKiAnalyses, eq(zvgKiAnalyses.listingId, zvgListings.id))
    .where(buildFinderWhere(queryFilters))
    .orderBy(desc(zvgKiAnalyses.analyzedAt), desc(zvgListings.createdAt), desc(zvgListings.id))
    .limit(MAX_FINDER_CANDIDATES);

  const mapped = rows
    .map((row) => mapQueryRow(row, medians, marktreferenzen))
    .filter((row) => matchesInvestorProfile(row, profileInput));
  const explicitStrategy =
    f.strategy && f.strategy !== "all" && f.strategy !== "wildcard" ? f.strategy : null;
  const resolved = mapped.flatMap((row) => {
    const strategy = selectDiscoveryStrategy(row, profileInput, {
      explicit: explicitStrategy,
      enforceProfileStrategies: !explicitStrategy,
    });
    return strategy ? [{ row, strategy }] : [];
  });

  let picks = f.einstiegOnly
    ? resolved
        .filter(({ row }) => passesEinstiegCriteria(row, profileInput))
        .map(({ row, strategy }) => enrichEinstiegPick(row, strategy, profileInput))
    : resolved.map(({ row, strategy }) => rowToInvestorPick(row, strategy, profileInput));

  if (f.discountMin != null) {
    picks = picks.filter((p) => {
      const gap = finderDiscountPct(f.strategy, p.metrics);
      return gap != null && gap >= f.discountMin!;
    });
  }

  if (f.roiMin != null) {
    picks = picks.filter(
      (p) => p.metrics.flipRoiPctMin != null && p.metrics.flipRoiPctMin >= f.roiMin!,
    );
  }

  if (f.cashflowMin != null) {
    picks = picks.filter((p) => pickMeetsCashflowMin(p.metrics.baseCashOnCashPct, f.cashflowMin));
  }

  if (f.strategy === "zeitnah") {
    picks = picks.filter((p) => isZeitnahTermin(p.listing.terminDate));
  } else if (f.terminMaxDays != null) {
    picks = picks.filter((p) => isTerminWithinDays(p.listing.terminDate, f.terminMaxDays!));
  }

  picks.sort((a, b) => b.chance.wert - a.chance.wert);

  return {
    picks: picks.slice(offset, offset + limit),
    total: picks.length,
    regionConflict: false,
  };
}

export type VeraenderungsArt = "wiederholungstermin" | "wertreduktion" | "neu";

export interface Veraenderung {
  listingId: string;
  slug: string;
  bundesland: string;
  titel: string;
  art: VeraenderungsArt;
  beschreibung: string;
  amDatum: Date;
  terminDate: Date | null;
}

/**
 * Was hat sich seit dem letzten Blick bewegt. Speist sich aus
 * zvg_auction_events, weil ein überschriebenes Termin- oder Verkehrswertfeld
 * genau die Bewegung verschluckt, die uns interessiert. Die Historie beginnt
 * mit der Einführung der Ereignistabelle — vorher gibt es schlicht nichts zu
 * zeigen, und das ist ehrlicher als eine rekonstruierte Bewegung.
 */
export async function fetchVeraenderungen(tage = 7, limit = 12): Promise<Veraenderung[]> {
  const seit = addZonedCalendarDays(startOfZonedDay(), -Math.max(1, Math.trunc(tage)));
  const seitIso = seit.toISOString();
  const ereignisse = (await db.execute(sql`
    WITH verlauf AS (
      SELECT
        e.listing_id,
        e.id,
        e.erfasst_am,
        e.termin_date,
        e.verkehrswert,
        lag(e.verkehrswert) OVER w AS vw_vorher,
        lag(e.termin_date) OVER w AS termin_vorher
      FROM zvg_auction_events e
      WINDOW w AS (PARTITION BY e.listing_id ORDER BY e.erfasst_am, e.id)
    )
    SELECT v.listing_id, l.slug, l.bundesland, l.typ, l.ort,
           v.termin_date, v.erfasst_am, v.verkehrswert,
           v.vw_vorher, v.termin_vorher
    FROM verlauf v
    JOIN zvg_listings l ON l.id = v.listing_id
    WHERE l.ist_aktiv
      AND l.needs_review = false
      AND v.erfasst_am >= ${seitIso}::timestamptz
      AND (
        -- Ein Einbruch um mehr als zwei Drittel ist keine Wertreduktion,
        -- sondern ein Teilobjekt-Verkehrswert aus derselben Bekanntmachung.
        (v.vw_vorher IS NOT NULL AND v.verkehrswert IS NOT NULL
          AND v.verkehrswert::numeric < v.vw_vorher::numeric
          AND v.verkehrswert::numeric >= v.vw_vorher::numeric / 3)
        OR (v.termin_vorher IS NOT NULL
          AND (v.termin_date AT TIME ZONE 'Europe/Berlin')::date
            IS DISTINCT FROM (v.termin_vorher AT TIME ZONE 'Europe/Berlin')::date)
      )
    ORDER BY v.erfasst_am DESC, v.listing_id, v.id DESC
    LIMIT ${limit}
  `)) as unknown as Array<{
    listing_id: string;
    slug: string;
    bundesland: string;
    typ: string | null;
    ort: string | null;
    termin_date: Date | null;
    erfasst_am: Date;
    verkehrswert: string | null;
    vw_vorher: string | null;
    termin_vorher: Date | null;
  }>;

  const titel = (typ: string | null, ort: string | null) =>
    [typ, ort].filter(Boolean).join(" · ") || "Objekt";

  const veraendert: Veraenderung[] = ereignisse.map((row) => {
    const alt = row.vw_vorher != null ? Number(row.vw_vorher) : null;
    const neu = row.verkehrswert != null ? Number(row.verkehrswert) : null;
    const istReduktion = alt != null && neu != null && neu < alt;
    return {
      listingId: row.listing_id,
      slug: row.slug,
      bundesland: row.bundesland,
      titel: titel(row.typ, row.ort),
      art: istReduktion ? "wertreduktion" : "wiederholungstermin",
      beschreibung: istReduktion
        ? `Verkehrswert von ${Math.round(alt!).toLocaleString("de-DE")} € auf ${Math.round(neu!).toLocaleString("de-DE")} € gesenkt`
        : "Neuer Termin angesetzt — Wiederholungstermin",
      amDatum: new Date(row.erfasst_am),
      terminDate: row.termin_date ? new Date(row.termin_date) : null,
    };
  });

  if (veraendert.length >= limit) return veraendert;

  const neueObjekte = await db
    .select({
      id: zvgListings.id,
      slug: zvgListings.slug,
      bundesland: zvgListings.bundesland,
      typ: zvgListings.typ,
      ort: zvgListings.ort,
      createdAt: zvgListings.createdAt,
      terminDate: zvgListings.terminDate,
    })
    .from(zvgListings)
    .where(
      and(
        eq(zvgListings.istAktiv, true),
        eq(zvgListings.needsReview, false),
        gte(zvgListings.createdAt, seit),
      ),
    )
    .orderBy(desc(zvgListings.createdAt), desc(zvgListings.id))
    .limit(limit - veraendert.length);

  const gesehen = new Set(veraendert.map((eintrag) => eintrag.listingId));
  return [
    ...veraendert,
    ...neueObjekte
      .filter((row) => !gesehen.has(row.id))
      .map((row) => ({
        listingId: row.id,
        slug: row.slug,
        bundesland: row.bundesland,
        titel: titel(row.typ, row.ort),
        art: "neu" as const,
        beschreibung: "Neu im Bestand",
        amDatum: row.createdAt ?? new Date(),
        terminDate: row.terminDate,
      })),
  ];
}

/**
 * Picks zu einer festen Liste von Objekten — für den Deal-Desk, der zeigt,
 * woran der Nutzer arbeitet, und dabei weder Strategiefilter noch
 * Entdeckungsschwellen anwenden darf: ein Objekt auf dem Desk bleibt sichtbar,
 * auch wenn es aus jedem Feed gefallen ist. Genau dann ist der Hinweis darauf
 * am wichtigsten.
 */
export async function fetchPicksByListingIds(
  listingIds: string[],
  profileInput?: Partial<InvestorProfile> | null,
  preferredStrategyByListingId?: Readonly<Record<string, string | null | undefined>>,
): Promise<Map<string, InvestorPick>> {
  if (listingIds.length === 0) return new Map();

  const [medians, marktreferenzen] = await Promise.all([fetchM2Medians(), fetchMarktreferenzen()]);

  const rows = await db
    .select({
      listing: zvgListings,
      ki: zvgKiAnalyses,
      coverImageUrl: COVER_IMAGE_SQL,
      terminAnzahl: TERMIN_ANZAHL_SQL,
      verkehrswertErst: VERKEHRSWERT_ERST_SQL,
      geringstesGebot: GERINGSTES_GEBOT_SQL,
      bestehendeRechte: BESTEHENDE_RECHTE_SQL,
      bildAnzahl: BILD_ANZAHL_SQL,
      preisProM2: PREIS_PRO_M2_SQL,
      cashflowYieldPct: CASHFLOW_YIELD_SQL,
    })
    .from(zvgListings)
    .innerJoin(zvgKiAnalyses, eq(zvgKiAnalyses.listingId, zvgListings.id))
    .where(inArray(zvgListings.id, listingIds));

  const picks = new Map<string, InvestorPick>();
  for (const row of rows) {
    if (row.listing.needsReview) continue;
    const mapped = mapQueryRow(row, medians, marktreferenzen);
    const strategy = selectDeskPickStrategy(
      (candidate) => rowToInvestorPick(mapped, candidate, profileInput).chance.wert,
      preferredStrategyByListingId?.[mapped.listing.id],
    );
    picks.set(mapped.listing.id, rowToInvestorPick(mapped, strategy, profileInput));
  }
  return picks;
}
