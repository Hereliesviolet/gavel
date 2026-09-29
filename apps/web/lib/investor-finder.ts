import type { PickStrategy } from "@/lib/investor-picks";
import type { InvestorPeriod } from "@/lib/investor-picks";
import { zvgKiAnalyses, zvgListings } from "@/drizzle/schema";
import { and, eq, gte, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { bundeslandColumnMatches, normalizeBundeslandSlug } from "@/lib/bundesland";
import { EINSTIEG_MAX_VW, EINSTIEG_MIN_VW, passesEinstiegCriteria } from "@/lib/einstieg-picks";
import { antiSignalPostgresPattern } from "@/lib/investor-risk";
import { listingTypeColumnMatches } from "@/lib/listing-type-filter";
import { calendarDaysUntil, exclusiveZonedCalendarHorizon, isUpcomingTermin } from "@/lib/utils";
import { upcomingTerminSql } from "@/lib/termin-sql";

/**
 * Presets sind der Ersatz für die vier früheren Strategieseiten: dieselbe
 * Auswahl, aber in einer Suche, in der sie sich weiter verengen lässt.
 */
export type FinderPreset =
  | "fix-flip"
  | "buy-hold"
  | "unter-markt"
  | "zeitnah"
  | "einsteiger-paket"
  | "flip-unter-150k"
  | "cashflow-nrw";

export const MAX_FINDER_LIMIT = 50;
export const MAX_FINDER_CANDIDATES = 500;
export const ZEITNAH_MAX_DAYS = 14;

export function isTerminWithinDays(
  termin: Date | string | null | undefined,
  maxDays: number,
  now = new Date(),
): boolean {
  if (!isUpcomingTermin(termin, now)) return false;
  const days = calendarDaysUntil(termin, now);
  return days != null && days <= maxDays;
}

export function isZeitnahTermin(
  termin: Date | string | null | undefined,
  now = new Date(),
): boolean {
  return isTerminWithinDays(termin, ZEITNAH_MAX_DAYS, now);
}

export function finderDiscountPct(
  strategy: PickStrategy | undefined,
  metrics: { marktlueckePct: number | null; discountVsMedianPct: number | null },
): number | null {
  if (strategy === "unter_markt") {
    return metrics.marktlueckePct;
  }
  return metrics.marktlueckePct ?? metrics.discountVsMedianPct;
}

export function unterMarktGapPct(metrics: { marktlueckePct: number | null }): number | null {
  return metrics.marktlueckePct != null && Number.isFinite(metrics.marktlueckePct)
    ? metrics.marktlueckePct
    : null;
}

export function pickMeetsCashflowMin(
  cashOnCashPct: number | null | undefined,
  cashflowMin: number | null | undefined,
): boolean {
  if (cashflowMin == null) return true;
  return cashOnCashPct != null && cashOnCashPct >= cashflowMin;
}
export const MAX_FINDER_OFFSET = 2_000;

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export interface FinderFilters {
  strategy?: PickStrategy;
  bundesland?: string[];
  objektarten?: string[];
  vwMin?: number;
  vwMax?: number;
  roiMin?: number;
  discountMin?: number;
  cashflowMin?: number;
  terminMaxDays?: number;
  einstiegOnly?: boolean;
  excludeHardRisk?: boolean;
  period?: InvestorPeriod;
  preset?: FinderPreset;
  limit?: number;
  offset?: number;
}

const PICK_STRATEGY_IDS: readonly PickStrategy[] = [
  "fix_flip",
  "buy_hold",
  "unter_markt",
  "zeitnah",
  "wildcard",
  "all",
];

function parsePickStrategy(raw: unknown): PickStrategy | undefined {
  return typeof raw === "string" && (PICK_STRATEGY_IDS as readonly string[]).includes(raw)
    ? (raw as PickStrategy)
    : undefined;
}

function parseFinderPreset(raw: unknown): FinderPreset | undefined {
  return typeof raw === "string" && raw in PRESET_FILTERS ? (raw as FinderPreset) : undefined;
}

const PRESET_FILTERS: Record<FinderPreset, Partial<FinderFilters>> = {
  "fix-flip": { strategy: "fix_flip" },
  "buy-hold": { strategy: "buy_hold" },
  "unter-markt": { strategy: "unter_markt" },
  zeitnah: { strategy: "zeitnah" },
  "einsteiger-paket": {
    vwMax: 350_000,
    einstiegOnly: true,
    excludeHardRisk: true,
  },
  "flip-unter-150k": {
    strategy: "fix_flip",
    vwMax: 150_000,
    roiMin: 5,
  },
  "cashflow-nrw": {
    strategy: "buy_hold",
    bundesland: ["nordrhein-westfalen"],
    cashflowMin: 3,
  },
};

/**
 * Aus derselben Definition wie die TS-Prädikate erzeugt (siehe
 * lib/investor-risk.ts). Vorher stand hier eine handgepflegte zweite Liste,
 * die von der TS-Variante abwich — unter anderem galten Schimmel und Räumung
 * in SQL als hart, in der Bewertung dagegen als materiell.
 */
export const FIX_FLIP_BASIS_SQL = or(
  isNotNull(zvgKiAnalyses.arvMinEur),
  isNotNull(zvgKiAnalyses.fixFlipGesamtkostenMinEur),
  sql`jsonb_typeof(COALESCE(${zvgKiAnalyses.fixFlipMassnahmen}, '[]'::jsonb)) = 'array'
    AND jsonb_array_length(COALESCE(${zvgKiAnalyses.fixFlipMassnahmen}, '[]'::jsonb)) > 0`,
)!;

export const ANTI_SIGNAL_SQL = sql`EXISTS (
  SELECT 1 FROM jsonb_array_elements_text(
    COALESCE(${zvgKiAnalyses.risikenInvestor}, '[]'::jsonb)
  ) AS r
  WHERE r ~* ${antiSignalPostgresPattern()}
)`;

export function applyPreset(filters: FinderFilters): FinderFilters {
  if (!filters.preset) return filters;
  const preset = PRESET_FILTERS[filters.preset];
  const merged: FinderFilters = { ...preset, preset: filters.preset };
  for (const [key, value] of Object.entries(filters) as [
    keyof FinderFilters,
    FinderFilters[keyof FinderFilters],
  ][]) {
    if (value !== undefined && key !== "preset") {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

export function buildFinderWhere(filters: FinderFilters) {
  const f = applyPreset(filters);
  const conditions = [
    eq(zvgListings.istAktiv, true),
    eq(zvgListings.needsReview, false),
    upcomingTerminSql(),
  ];

  if (f.vwMin != null) {
    conditions.push(gte(zvgListings.verkehrswert, sql`${f.vwMin}`));
  }
  if (f.vwMax != null) {
    conditions.push(lte(zvgListings.verkehrswert, sql`${f.vwMax}`));
  }
  if (f.bundesland?.length) {
    const bundeslandMatch = or(
      ...f.bundesland.map((bl) =>
        bundeslandColumnMatches(zvgListings.bundesland, normalizeBundeslandSlug(bl)),
      ),
    );
    if (bundeslandMatch) conditions.push(bundeslandMatch);
  }
  if (f.objektarten?.length) {
    const typeMatch = listingTypeColumnMatches(f.objektarten);
    if (typeMatch) conditions.push(typeMatch);
  }
  if (f.terminMaxDays != null) {
    conditions.push(isNotNull(zvgListings.terminDate));
    conditions.push(lt(zvgListings.terminDate, exclusiveZonedCalendarHorizon(f.terminMaxDays)));
    conditions.push(upcomingTerminSql());
  }

  if (f.strategy !== "zeitnah") {
    conditions.push(
      or(isNull(zvgKiAnalyses.investmentScore), ne(zvgKiAnalyses.investmentScore, "abraten"))!,
    );
  }

  // P-04: einstiegOnly impliziert dieselben Pflichtkriterien wie
  // passesEinstiegCriteria() (VW-Band + kein hartes Risiko) - hier bereits in
  // SQL erzwingen, statt bis zu 500 Zeilen zu laden und den Großteil danach
  // in JS wieder zu verwerfen. passesEinstiegCriteria() bleibt trotzdem als
  // abschließende JS-Prüfung bestehen (Median-/Signal-Kriterien lassen sich
  // ohne Median-Join nicht verlustfrei nach SQL verschieben).
  if (f.einstiegOnly) {
    conditions.push(gte(zvgListings.verkehrswert, sql`${EINSTIEG_MIN_VW}`));
    conditions.push(lte(zvgListings.verkehrswert, sql`${EINSTIEG_MAX_VW}`));
  }
  if (f.excludeHardRisk || f.einstiegOnly) {
    conditions.push(sql`NOT ${ANTI_SIGNAL_SQL}`);
  }

  if (f.strategy === "fix_flip") {
    // Nur noch die Datengrundlage lässt sich in SQL filtern. Die Marge kommt
    // aus dem Underwriting und wird deshalb erst nach dem Laden geprüft
    // (siehe roiMin in filterFinderPicks) — eine persistierte Flip-Kennzahl
    // gibt es nicht mehr.
    conditions.push(FIX_FLIP_BASIS_SQL);
  } else if (f.strategy === "zeitnah") {
    conditions.push(isNotNull(zvgListings.terminDate));
    conditions.push(lt(zvgListings.terminDate, exclusiveZonedCalendarHorizon(ZEITNAH_MAX_DAYS)));
    conditions.push(upcomingTerminSql());
  }

  return and(...conditions);
}

export function parseFinderFiltersFromSearchParams(
  sp: Record<string, string | string[] | undefined>,
): FinderFilters {
  const num = (key: string) => {
    const v = sp[key];
    if (typeof v !== "string" || !v) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  const bundesland =
    typeof sp.bundesland === "string" && sp.bundesland
      ? sp.bundesland.split(",").filter(Boolean)
      : undefined;

  const strategy = parsePickStrategy(sp.strategy);
  const preset = parseFinderPreset(sp.preset);

  const filters: FinderFilters = {
    strategy,
    bundesland,
    vwMin: num("vw_min"),
    vwMax: num("vw_max"),
    roiMin: num("roi_min"),
    discountMin: num("discount_min"),
    cashflowMin: num("cashflow_min"),
    terminMaxDays: num("termin_max"),
    period: sp.period === "month" ? "month" : "week",
    preset,
    limit: clampInt(num("limit") ?? 20, 1, MAX_FINDER_LIMIT),
    offset: clampInt(num("offset") ?? 0, 0, MAX_FINDER_OFFSET),
  };

  if (typeof sp.einstieg === "string") {
    filters.einstiegOnly = sp.einstieg === "1";
  }
  if (typeof sp.no_hard_risk === "string") {
    filters.excludeHardRisk = sp.no_hard_risk !== "0";
  }

  return filters;
}
