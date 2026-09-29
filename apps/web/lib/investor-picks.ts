import type { FixFlipMassnahme } from "@/components/zvg/detail/ki-sections/investment-fixflip";
import { computeBenchmarkDiscountPct, type PeerBenchmark } from "@/lib/investor-benchmarks";
import { evaluateInvestorQuality, type InvestorQualityResult } from "@/lib/investor-quality";
import {
  DEFAULT_INVESTOR_PROFILE,
  normalizeInvestorProfile,
  type InvestorProfile,
} from "@/lib/investor-profile";
import {
  berechneChance,
  type ChanceErgebnis,
  type Konfidenz,
  type Praesentation,
  type Terminhistorie,
} from "@/lib/investor-signals";
import {
  calculateInvestmentUnderwriting,
  flipKennzahlen,
  kaufpreisAusZvg,
  type FlipEinschaetzung,
  type FlipKennzahlen,
  type InvestmentUnderwriting,
} from "@/lib/underwriting";
import {
  berechneMarktluecke,
  listingKategorieLabel,
  marktmieteEur,
  type Marktreferenz,
} from "@/lib/market-reference";
import { findBundesland } from "@/lib/bundesland";
import {
  addZonedCalendarDays,
  berechneErwerbskosten,
  calendarDaysUntil,
  isUpcomingTermin,
  startOfZonedDay,
} from "@/lib/utils";

export type PickStrategy = "fix_flip" | "buy_hold" | "unter_markt" | "zeitnah" | "wildcard" | "all";

export type InvestmentScore = "attraktiv" | "neutral" | "abraten";

export type EinstiegTyp = "flip" | "kapitalanlage" | "schnaeppchen" | "kombi";

export type InvestorPeriod = "week" | "month";

export interface InvestorPickMetrics {
  verkehrswert: number | null;
  preisProM2: number | null;
  kategorieMedianM2: number | null;
  /** Nur noch sekundäre Plausibilitätszahl gegen gerichtliche Werte. */
  discountVsMedianPct: number | null;
  /** Abstand zum Angebotspreis-Niveau im Mikromarkt; null ohne belastbare Stichprobe. */
  marktlueckePct: number | null;
  marktreferenzStichprobe: number;
  /** Angesetzte Kaltmiete und woher sie kommt. */
  mieteEur: number | null;
  mietHerkunft: Mietherkunft;
  /** Aus der Engine, nicht mehr aus der Datenbank: konservatives Szenario. */
  flipRoiPctMin: number | null;
  flipGewinnMinEur: number | null;
  flipEinschaetzung: FlipEinschaetzung | null;
  cashflowYieldPct: number | null;
  terminTage: number | null;
  investmentScore: InvestmentScore | null;
  benchmarkSampleSize: number;
  benchmarkConfidence: PeerBenchmark["confidence"];
  benchmarkScope: PeerBenchmark["scope"];
  analysisStatus: InvestorQualityResult["status"];
  interiorInspected: boolean | null;
  arvConfidence: string | null;
  baseDscr: number | null;
  baseCashOnCashPct: number | null;
  baseCashflowBeforeTaxEur: number | null;
  baseFlipMarginPct: number | null;
  bearFlipProfitEur: number | null;
  maxBidEur: number | null;
  referenceBidEur: number | null;
  referenceBidPct: number | null;
  underwritingProvisional: boolean;
  unknownCostItems: string[];
}

export interface InvestorPickListingData {
  id: string;
  slug: string;
  bundesland: string;
  bundeslandName: string;
  typ: string | null;
  kategorie: string | null;
  adresse: string | null;
  ort: string | null;
  verkehrswert: number | null;
  wohnflaecheM2: number | null;
  zimmer: string | null;
  terminDate: Date | null;
  amtsgericht: string | null;
  coverImageUrl: string | null;
}

export interface InvestorPickKiFields {
  investmentScore?: string | null;
  investmentScoreBegruendung?: string | null;
  zusammenfassung?: string | null;
  fixFlipMassnahmen?: FixFlipMassnahme[] | null;
  risikenInvestor?: string[] | null;
  moeglicherKaltmiete?: number | string | null;
  hausgeld?: number | string | null;
  fixFlipGesamtkostenMinEur?: number | null;
  fixFlipGesamtkostenMaxEur?: number | null;
  arvMinEur?: number | null;
  arvMaxEur?: number | null;
  arvKonfidenz?: string | null;
  arvBegruendung?: string | null;
  innenbesichtigung?: boolean | null;
  holdingMonate?: number | null;
  analyzedAt?: Date | null;
}

export interface InvestorPick {
  listingId: string;
  slug: string;
  bundesland: string;
  strategy: PickStrategy;
  /** Einziger sichtbarer und einziger sortierender Score, inklusive Konfidenz. */
  chance: ChanceErgebnis;
  badges: string[];
  pitch: string;
  hook: string;
  subtitle: string;
  umsetzung: string[];
  massnahmen: FixFlipMassnahme[];
  risiken: string[];
  nextChecks: string[];
  heroCaution?: boolean;
  einstiegTyp?: EinstiegTyp;
  geschaetzteGesamtinvestition?: number | null;
  erwarteteErsparnisEur?: number | null;
  hardRisikoCount?: number;
  quality: InvestorQualityResult;
  metrics: InvestorPickMetrics;
  listing: InvestorPickListingData;
}

export interface InvestorPickRow {
  listing: {
    id: string;
    slug: string;
    bundesland: string;
    bundeslandName: string;
    typ: string | null;
    kategorie: string | null;
    adresse: string | null;
    ort: string | null;
    verkehrswert: string | number | null;
    wohnflaecheM2: string | number | null;
    zimmer: string | number | null;
    terminDate: Date | null;
    amtsgericht: string | null;
    plz: string | null;
    createdAt: Date | null;
    needsReview?: boolean | null;
    dataQualityFlags?: unknown;
  };
  ki: InvestorPickKiFields;
  coverImageUrl: string | null;
  preisProM2: number | null;
  cashflowYieldPct: number | null;
  terminTage: number | null;
  kategorieMedianM2: number | null;
  benchmark?: PeerBenchmark | null;
  /** Angebotspreis-Niveau im Mikromarkt — Basis der Marktlücke. */
  marktreferenzKauf?: Marktreferenz | null;
  /** Angebotsmieten im Mikromarkt — primäre Buy-and-Hold-Basis. */
  marktreferenzMiete?: Marktreferenz | null;
  /** Verdichtete zvg_auction_events, Basis für Wiederholungstermin und Wertreduktion. */
  historie?: Terminhistorie | null;
  praesentation?: Praesentation | null;
  /** Aus der Terminsbestimmung geparst; null heißt unbekannt, nie geschätzt. */
  geringstesGebotEur?: number | null;
  /** Kapitalwert bestehenbleibender Rechte; 0 ist eine Aussage, null nicht. */
  bestehendeRechteEur?: number | null;
  rechteVerifiziert?: boolean;
}

const STRATEGY_BADGES: Record<Exclude<PickStrategy, "all" | "wildcard">, string> = {
  fix_flip: "Fix & Flip",
  buy_hold: "Buy & Hold",
  unter_markt: "Marktlücke",
  zeitnah: "Zeitnah",
};

const PRIORITAET_ORDER: Record<string, number> = { hoch: 0, mittel: 1, niedrig: 2 };

export function getPeriodStart(period: InvestorPeriod, now = new Date()): Date {
  return addZonedCalendarDays(startOfZonedDay(now), period === "week" ? -7 : -30);
}

export function computeCashflowYield(
  miete: number | string | null | undefined,
  hausgeld: number | string | null | undefined,
  kaufpreis: number | string | null | undefined,
): number | null {
  const m = miete != null ? Number(miete) : null;
  const h = hausgeld != null ? Number(hausgeld) : 0;
  const k = kaufpreis != null ? Number(kaufpreis) : null;
  if (m == null || m <= 0 || k == null || k <= 0 || Number.isNaN(m) || Number.isNaN(k)) {
    return null;
  }
  return (((m - h) * 12) / k) * 100;
}

export function computeTerminTage(
  terminDate: Date | null | undefined,
  now = new Date(),
): number | null {
  if (!isUpcomingTermin(terminDate, now)) return null;
  return calendarDaysUntil(terminDate, now);
}

export function buildPitchFromDbFields(
  ki: InvestorPickKiFields,
  listing: { ort?: string | null },
  flipBegruendung?: string | null,
): string {
  if (ki.investmentScoreBegruendung?.trim()) {
    return ki.investmentScoreBegruendung.trim();
  }
  if (flipBegruendung?.trim()) {
    return flipBegruendung.trim();
  }
  if (ki.zusammenfassung?.trim()) {
    return ki.zusammenfassung.trim().slice(0, 200);
  }
  return `Zwangsversteigerung${listing.ort ? ` in ${listing.ort}` : ""} — Detailanalyse für eigene Einschätzung öffnen.`;
}

export function getCalendarWeek(): number {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function getPeriodLabel(period: InvestorPeriod): string {
  if (period === "month") {
    return new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(new Date());
  }
  return `KW ${getCalendarWeek()}`;
}

export function buildBriefingSubtitle(
  period: InvestorPeriod,
  dealCount: number,
  activeObjects: number,
  strategy?: PickStrategy,
): string {
  const periodLabel = getPeriodLabel(period);
  const strategyLabel =
    strategy && strategy !== "all"
      ? STRATEGY_BADGES[strategy as keyof typeof STRATEGY_BADGES]
      : null;
  const countPart = strategyLabel
    ? `${dealCount} ${strategyLabel}-Kandidaten`
    : `${dealCount} Kandidaten`;
  return `Dein Briefing für ${periodLabel} · ${countPart} aus ${activeObjects.toLocaleString("de-DE")} aktiven Objekten`;
}

export function formatListingTitle(pick: InvestorPick): string {
  const ort = pick.listing.ort ?? pick.listing.bundeslandName;
  const typ = pick.listing.typ?.trim();
  if (typ) {
    const title = `${ort} · ${typ}`;
    return title.length > 52 ? `${title.slice(0, 49)}…` : title;
  }

  const addr = pick.listing.adresse?.trim();
  if (addr) {
    const parts = addr
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const street =
      parts.length > 1 && /^\d+$/.test(parts[0] ?? "")
        ? parts.slice(1).join(", ")
        : (parts[0] ?? addr);
    if (street && !/^\d+$/.test(street)) {
      const title = `${ort} · ${street}`;
      return title.length > 52 ? `${title.slice(0, 49)}…` : title;
    }
    const title = `${ort} · ${addr}`;
    return title.length > 52 ? `${title.slice(0, 49)}…` : title;
  }

  return ort;
}

export function getFeaturedDealLabel(strategy: PickStrategy): string {
  switch (strategy) {
    case "fix_flip":
      return "Stärkster Flip-Kandidat";
    case "buy_hold":
      return "Top Kapitalanlage";
    case "unter_markt":
      return "Größte Marktlücke";
    case "zeitnah":
      return "Dringendster Termin";
    default:
      return "Stärkster Research-Kandidat";
  }
}

export function buildStrategyCountLine(
  counts: Record<Exclude<PickStrategy, "all" | "wildcard">, number>,
): string {
  const parts: string[] = [];
  if (counts.fix_flip > 0) {
    parts.push(`${counts.fix_flip} Flip-Kandidat${counts.fix_flip > 1 ? "en" : ""}`);
  }
  if (counts.buy_hold > 0) parts.push(`${counts.buy_hold} Buy&Hold`);
  if (counts.unter_markt > 0) {
    parts.push(`${counts.unter_markt} Marktlücken`);
  }
  if (counts.zeitnah > 0) parts.push(`${counts.zeitnah} zeitnah`);
  return parts.join(" · ") || "Keine belastbaren Kandidaten in dieser Periode";
}

function parseRisiken(ki: InvestorPickKiFields): string[] {
  const raw = ki.risikenInvestor;
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is string => typeof r === "string" && r.trim().length > 0).slice(0, 5);
}

export function parseMassnahmen(ki: InvestorPickKiFields): FixFlipMassnahme[] {
  return [...(ki.fixFlipMassnahmen ?? [])].sort(
    (a, b) =>
      (PRIORITAET_ORDER[a.prioritaet ?? "mittel"] ?? 1) -
      (PRIORITAET_ORDER[b.prioritaet ?? "mittel"] ?? 1),
  );
}

function formatVwShort(vw: number | null): string {
  if (vw == null) return "—";
  if (vw >= 1_000_000) return `${(vw / 1_000_000).toFixed(1)}M €`;
  if (vw >= 1_000) return `${Math.round(vw / 1_000)}k €`;
  return `${Math.round(vw).toLocaleString("de-DE")} €`;
}

export function formatTerminRelativ(tage: number): string {
  if (tage <= 0) return "heute";
  if (tage === 1) return "in 1 Tag";
  return `in ${tage} Tagen`;
}

export function buildDealHook(
  pick: Pick<InvestorPick, "strategy" | "metrics" | "listing" | "pitch">,
): string {
  const ort = pick.listing.ort ?? pick.listing.bundeslandName;
  const kat = listingKategorieLabel(pick.listing.kategorie, pick.listing.typ);

  switch (pick.strategy) {
    case "fix_flip":
      if (pick.metrics.baseFlipMarginPct != null) {
        const m2 =
          pick.metrics.preisProM2 != null
            ? ` bei ${Math.round(pick.metrics.preisProM2).toLocaleString("de-DE")} €/m²`
            : "";
        const referenz = pick.metrics.referenceBidPct?.toFixed(0) ?? "70";
        // Das Referenzgebot ist eine Annahme, kein Angebot. Ist die Marge dort
        // negativ, ist die handlungsleitende Zahl der Preis, ab dem es
        // aufgeht — nicht die negative Marge selbst.
        if (pick.metrics.baseFlipMarginPct <= 0) {
          if (pick.metrics.maxBidEur != null) {
            const grenze = Math.round(pick.metrics.maxBidEur).toLocaleString("de-DE");
            return `Rechnet sich erst unter ${grenze} € in ${ort} — beim ${referenz}-%-Referenzgebot ${pick.metrics.baseFlipMarginPct.toFixed(0)} % Marge${m2}`;
          }
          return `Kein Gebotspreis erreicht die Zielmarge in ${ort} — ${kat}, ${pick.metrics.baseFlipMarginPct.toFixed(0)} % beim ${referenz}-%-Referenzgebot${m2}`;
        }
        return `${pick.metrics.baseFlipMarginPct.toFixed(0)} % Flip-Marge beim ${referenz}-%-Referenzgebot in ${ort} — ${kat} mit Sanierungspotenzial${m2}`;
      }
      break;
    case "buy_hold":
      if (pick.metrics.baseCashOnCashPct != null && pick.metrics.baseDscr != null) {
        return (
          `${pick.metrics.baseCashOnCashPct.toFixed(1)} % Cash-on-Cash · ` +
          `DSCR ${pick.metrics.baseDscr.toFixed(2)} in ${ort} — nach Profil tragfähiger Base Case`
        );
      }
      if (pick.metrics.cashflowYieldPct != null) {
        return `${pick.metrics.cashflowYieldPct.toFixed(1)} % einfache Mietrendite am Verkehrswert in ${ort} — Gebot und Finanzierung noch prüfen`;
      }
      break;
    case "unter_markt":
      if (pick.metrics.preisProM2 != null) {
        const m2 = Math.round(pick.metrics.preisProM2).toLocaleString("de-DE");
        const luecke = pick.metrics.marktlueckePct;
        const lueckePart =
          luecke != null && luecke > 0
            ? ` — ${luecke.toFixed(0)} % unter dem Angebotsniveau im Mikromarkt`
            : luecke != null && luecke < 0
              ? " — über dem Angebotsniveau im Mikromarkt"
              : " — keine belastbare Marktreferenz im Mikromarkt";
        return `${m2} €/m² Verkehrswertbasis in ${ort}${lueckePart}`;
      }
      break;
    case "zeitnah":
      if (pick.metrics.terminTage != null) {
        return `Versteigerung ${formatTerminRelativ(pick.metrics.terminTage)} — ${ort}, VW ${formatVwShort(pick.metrics.verkehrswert)}`;
      }
      break;
    default:
      break;
  }

  return pick.pitch.length > 80 ? `${pick.pitch.slice(0, 77)}…` : pick.pitch;
}

export function buildDealSubtitle(pick: Pick<InvestorPick, "hook" | "risiken">): string {
  const core = pick.hook.split(" — ")[0];
  const risk = pick.risiken[0];
  if (risk) {
    return `${core} · ${risk} — vor Gebot klären`;
  }
  return core;
}

export function buildUmsetzungFromDbFields(
  ki: InvestorPickKiFields,
  strategy: PickStrategy,
): string[] {
  if (strategy === "fix_flip") {
    const massnahmen = [...(ki.fixFlipMassnahmen ?? [])].sort(
      (a, b) =>
        (PRIORITAET_ORDER[a.prioritaet ?? "mittel"] ?? 1) -
        (PRIORITAET_ORDER[b.prioritaet ?? "mittel"] ?? 1),
    );
    const steps = massnahmen.slice(0, 3).map((m) => m.beschreibung);
    if (steps.length > 0) {
      return [...steps, "Detailanalyse öffnen und Gutachten prüfen"];
    }
    return ["Sanierungsumfang im Gutachten prüfen", "Detailanalyse öffnen"];
  }

  if (strategy === "buy_hold") {
    return [
      "Miete und Vermietbarkeit gegen Markt prüfen",
      "Hausgeld und Bewirtschaftungskosten verifizieren",
      "Finanzierung und Cashflow kalkulieren",
      "Detailanalyse öffnen",
    ];
  }

  if (strategy === "unter_markt") {
    return [
      "Marktlücke gegen die Vergleichsangebote prüfen – Angebotspreise liegen über Zuschlagspreisen",
      "Gutachten auf Widersprüche und Mängel lesen",
      "Geringstes Gebot und bestehenbleibende Rechte aus den Terminsbestimmungen prüfen",
      "Persönliches Maximalgebot samt Reserven berechnen",
      "Detailanalyse öffnen",
    ];
  }

  if (strategy === "zeitnah") {
    return [
      "Termin im Kalender notieren",
      "Terminsbestimmungen, Sicherheitsleistung und geringstes Gebot prüfen",
      "Erwerbskosten, Rechte, Räumungs- und Risikoreserven kalkulieren",
      "Gebotsstrategie vor dem Termin festlegen",
      "Detailanalyse öffnen",
    ];
  }

  return ["Detailanalyse öffnen", "Gutachten und Termin eigenständig prüfen"];
}

/**
 * Deterministische Scores (0–100) je Strategie — siehe docs/INVESTOR.md.
 */
function fallbackBenchmark(row: InvestorPickRow): PeerBenchmark {
  return {
    medianEurM2: row.kategorieMedianM2,
    p25EurM2: null,
    p75EurM2: null,
    sampleSize: row.kategorieMedianM2 != null ? 1 : 0,
    scope: row.kategorieMedianM2 != null ? "category_state" : "none",
    confidence: "insufficient",
    sufficient: false,
    reliable: false,
  };
}

function qualityForRow(
  row: InvestorPickRow,
  benchmark: PeerBenchmark = row.benchmark ?? fallbackBenchmark(row),
  flip: FlipKennzahlen | null = null,
): InvestorQualityResult {
  return evaluateInvestorQuality({
    listing: {
      verkehrswert: row.listing.verkehrswert,
      wohnflaecheM2: row.listing.wohnflaecheM2,
      terminDate: row.listing.terminDate,
      needsReview: row.listing.needsReview,
      dataQualityFlags: row.listing.dataQualityFlags,
    },
    ki: {
      moeglicherKaltmiete: row.ki.moeglicherKaltmiete,
      hausgeld: row.ki.hausgeld,
      fixFlipMassnahmen: row.ki.fixFlipMassnahmen,
      fixFlipGesamtkostenMinEur: row.ki.fixFlipGesamtkostenMinEur,
      fixFlipGesamtkostenMaxEur: row.ki.fixFlipGesamtkostenMaxEur,
      arvMinEur: row.ki.arvMinEur,
      arvMaxEur: row.ki.arvMaxEur,
      arvKonfidenz: row.ki.arvKonfidenz,
      innenbesichtigung: row.ki.innenbesichtigung,
      risikenInvestor: row.ki.risikenInvestor,
      analyzedAt: row.ki.analyzedAt,
    },
    flip,
    preisProM2: row.preisProM2,
    benchmark,
    monthlyRentEur: mieteFuerZeile(row).eur,
    marktlueckePct: berechneMarktluecke(row.preisProM2, row.marktreferenzKauf),
  });
}

export type Mietherkunft = "marktreferenz" | "gutachten" | "keine";

/**
 * Die Mietreferenz aus geernteten Angeboten schlägt die Gutachten- bzw.
 * LLM-Miete, weil sie auf beobachteten Forderungen beruht statt auf einer
 * Schätzung. Die Gutachtenmiete bleibt als Gegenprobe erhalten: weichen beide
 * stark voneinander ab, ist das ein Prüfhinweis, kein stiller Mittelwert.
 */
export function mieteFuerZeile(row: InvestorPickRow): {
  eur: number | null;
  herkunft: Mietherkunft;
  gutachtenEur: number | null;
} {
  const gutachtenEur =
    row.ki.moeglicherKaltmiete == null ? null : Number(row.ki.moeglicherKaltmiete);
  const marktEur = marktmieteEur(
    row.listing.wohnflaecheM2 == null ? null : Number(row.listing.wohnflaecheM2),
    row.marktreferenzMiete,
  );
  if (marktEur != null && marktEur > 0) {
    return { eur: marktEur, herkunft: "marktreferenz", gutachtenEur };
  }
  if (gutachtenEur != null && gutachtenEur > 0) {
    return { eur: gutachtenEur, herkunft: "gutachten", gutachtenEur };
  }
  return { eur: null, herkunft: "keine", gutachtenEur };
}

export function cashflowYieldFuerZeile(row: InvestorPickRow): number | null {
  return computeCashflowYield(mieteFuerZeile(row).eur, row.ki.hausgeld, row.listing.verkehrswert);
}

function underwritingForRow(
  row: InvestorPickRow,
  profileInput?: Partial<InvestorProfile> | null,
): InvestmentUnderwriting {
  const courtValueEur = row.listing.verkehrswert != null ? Number(row.listing.verkehrswert) : 0;
  const kaufpreis = kaufpreisAusZvg(courtValueEur, row.geringstesGebotEur);
  const purchasePriceEur = kaufpreis?.eur ?? 0;
  const bundesland = findBundesland(row.listing.bundesland)?.slug ?? row.listing.bundesland;
  const acquisitionCostsEur =
    purchasePriceEur > 0
      ? berechneErwerbskosten(courtValueEur, purchasePriceEur, bundesland).gesamt
      : 0;
  const unknownCostItems = ["Räumungs-, Übergabe- und Vollstreckungskosten"];
  if (kaufpreis?.quelle !== "geringstes_gebot") {
    unknownCostItems.unshift("Geringstes Gebot (nicht aus der Akte gelesen)");
  }
  if (!row.rechteVerifiziert) {
    unknownCostItems.unshift("Bestehenbleibende Rechte");
  }
  if (row.ki.innenbesichtigung !== true) {
    unknownCostItems.push("Zustandsrisiko ohne bestätigte Innenbesichtigung");
  }

  return calculateInvestmentUnderwriting(
    {
      purchasePriceEur,
      kaufpreis,
      acquisitionCostsEur,
      bundesland,
      courtValueEur,
      referenceBidPct: kaufpreis?.anteilVerkehrswertPct ?? null,
      riskReserveEur: courtValueEur * 0.05,
      possessionReserveEur: row.ki.innenbesichtigung === true ? 0 : courtValueEur * 0.02,
      survivingRightsEur: row.bestehendeRechteEur ?? 0,
      auctionTermsVerified:
        kaufpreis?.quelle === "geringstes_gebot" && row.rechteVerifiziert === true,
      unknownCostItems,
      monthlyRentEur: mieteFuerZeile(row).eur,
      monthlyHausgeldEur: row.ki.hausgeld == null ? null : Number(row.ki.hausgeld),
      livingAreaM2: row.listing.wohnflaecheM2 == null ? null : Number(row.listing.wohnflaecheM2),
      renovationMinEur: row.ki.fixFlipGesamtkostenMinEur,
      renovationMaxEur: row.ki.fixFlipGesamtkostenMaxEur,
      arvMinEur: row.ki.arvMinEur,
      arvMaxEur: row.ki.arvMaxEur,
      holdingMonths: row.ki.holdingMonate,
    },
    profileInput,
  );
}

function buyHoldMeetsProfile(
  underwriting: InvestmentUnderwriting,
  profile: InvestorProfile,
): boolean {
  const bear = underwriting.buyHold.find((item) => item.name === "bear");
  const base = underwriting.buyHold.find((item) => item.name === "base");
  if (!bear || !base || base.cashOnCashPct == null) return false;
  const dscrPass = base.dscr == null || base.dscr >= profile.minDscr;
  return (
    bear.cashflowBeforeTaxEur >= 0 &&
    dscrPass &&
    base.cashOnCashPct >= profile.targetCashOnCashPct &&
    base.equityRequiredEur <= profile.maxEquityEur
  );
}

function fixFlipMeetsProfile(
  underwriting: InvestmentUnderwriting,
  profile: InvestorProfile,
): boolean {
  const bear = underwriting.fixFlip.find((item) => item.name === "bear");
  const base = underwriting.fixFlip.find((item) => item.name === "base");
  if (!bear || !base) return false;
  return (
    bear.profitEur >= 0 &&
    base.marginOnCostPct >= profile.targetFlipMarginPct &&
    base.equityRequiredEur <= profile.maxEquityEur &&
    base.holdingMonths <= profile.maxHoldingMonths
  );
}

function riskMeetsProfile(quality: InvestorQualityResult, profile: InvestorProfile): boolean {
  if (quality.riskAssessment.critical.length > 0) return false;
  const allowedMaterialRisks =
    profile.riskTolerance === "opportunistic" ? 2 : profile.riskTolerance === "balanced" ? 1 : 0;
  return quality.riskAssessment.material.length <= allowedMaterialRisks;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function hasPositiveNumber(value: number | string | null | undefined): boolean {
  return value != null && Number.isFinite(Number(value)) && Number(value) > 0;
}

export function hasFixFlipBasis(ki: {
  fixFlipMassnahmen?: { length?: number } | null;
  arvMinEur?: number | string | null;
  fixFlipGesamtkostenMinEur?: number | string | null;
}): boolean {
  return (
    (ki.fixFlipMassnahmen?.length ?? 0) > 0 ||
    hasPositiveNumber(ki.arvMinEur) ||
    hasPositiveNumber(ki.fixFlipGesamtkostenMinEur)
  );
}

/**
 * Ist das Objekt überhaupt ein Kandidat für die genannte Strategie?
 *
 * Ersetzt den früheren Schwellenvergleich auf computeOpportunityScore. Die
 * Frage "lohnt sich das?" beantwortet jetzt ausschließlich die Chance; hier
 * geht es nur noch darum, ob die Strategie zum Objekt passt.
 */
export function isDiscoveryCandidate(
  row: InvestorPickRow,
  strategy: Exclude<PickStrategy, "all" | "wildcard">,
  profileInput?: Partial<InvestorProfile> | null,
  options?: { enforceProfileStrategies?: boolean },
): boolean {
  if (row.listing.needsReview || !hasPositiveNumber(row.listing.verkehrswert)) {
    return false;
  }
  const profile = normalizeInvestorProfile(profileInput ?? DEFAULT_INVESTOR_PROFILE);
  if (
    strategy !== "zeitnah" &&
    options?.enforceProfileStrategies !== false &&
    !profile.strategies.includes(strategy)
  ) {
    return false;
  }

  if (strategy === "zeitnah") {
    return row.terminTage != null && row.terminTage <= 14;
  }
  if (strategy === "fix_flip") {
    return hasFixFlipBasis(row.ki);
  }
  if (strategy === "buy_hold") {
    return row.ki.investmentScore !== "abraten" && mieteFuerZeile(row).eur != null;
  }
  // unter_markt hängt an einer positiven Marktlücke, nicht nur daran, dass
  // eine Referenz berechenbar ist. Über Markt ist keine Discovery-Lücke.
  const luecke = berechneMarktluecke(row.preisProM2, row.marktreferenzKauf);
  return luecke != null && luecke > 0;
}

export const FINDER_DISCOVERY_STRATEGIES = [
  "fix_flip",
  "buy_hold",
  "unter_markt",
  "zeitnah",
] as const;

/**
 * Welche Strategie die ungefasste Suche an ein Objekt hängt.
 *
 * Chance.wert ist strategieunabhängig — `selectDeskPickStrategy` über die
 * Chance würde immer Fix & Flip wählen und Buy-&-Hold-/Marktlücke-/Zeitnah-
 * Kandidaten verwerfen. Heute prüft jede Strategie einzeln; hier dasselbe.
 */
export function selectDiscoveryStrategy(
  row: InvestorPickRow,
  profileInput?: Partial<InvestorProfile> | null,
  options?: {
    explicit?: Exclude<PickStrategy, "all" | "wildcard"> | null;
    enforceProfileStrategies?: boolean;
  },
): Exclude<PickStrategy, "all" | "wildcard"> | null {
  const enforceProfileStrategies = options?.enforceProfileStrategies !== false;
  const candidates: Exclude<PickStrategy, "all" | "wildcard">[] = options?.explicit
    ? [options.explicit]
    : [...FINDER_DISCOVERY_STRATEGIES];
  for (const strategy of candidates) {
    if (isDiscoveryCandidate(row, strategy, profileInput, { enforceProfileStrategies })) {
      return strategy;
    }
  }
  return null;
}

export function buildBadges(
  strategy: PickStrategy,
  ki: InvestorPickKiFields,
  flipEinschaetzung: FlipEinschaetzung | null = null,
): string[] {
  const badges: string[] = [];
  if (strategy !== "all" && strategy !== "wildcard" && STRATEGY_BADGES[strategy]) {
    badges.push(STRATEGY_BADGES[strategy]);
  }
  if (flipEinschaetzung === "attraktiv") badges.push("Fix & Flip");
  if (ki.investmentScore === "attraktiv") badges.push("Attraktiv");
  if (ki.investmentScore === "abraten") badges.push("Vorsicht");
  return [...new Set(badges)];
}

export function rowToInvestorPick(
  row: InvestorPickRow,
  strategy: PickStrategy,
  profileInput?: Partial<InvestorProfile> | null,
): InvestorPick {
  const verkehrswert = row.listing.verkehrswert != null ? Number(row.listing.verkehrswert) : null;

  const massnahmen = parseMassnahmen(row.ki);
  const risiken = parseRisiken(row.ki);

  const benchmark = row.benchmark ?? fallbackBenchmark(row);
  const medianM2 = benchmark.medianEurM2;
  const rawDiscount = computeBenchmarkDiscountPct(row.preisProM2, benchmark);
  const discountVsMedianPct = rawDiscount == null ? null : Math.max(0, rawDiscount);
  const marktlueckePct = berechneMarktluecke(row.preisProM2, row.marktreferenzKauf);
  const miete = mieteFuerZeile(row);
  const underwriting = underwritingForRow(row, profileInput);
  const flip = flipKennzahlen(underwriting);
  const quality = qualityForRow(row, benchmark, flip);
  const pitch = buildPitchFromDbFields(row.ki, row.listing, flip?.begruendung);
  const chance = berechneChance({
    verkehrswert,
    terminDate: row.listing.terminDate,
    preisProM2: row.preisProM2,
    benchmark,
    marktreferenzKauf: row.marktreferenzKauf ?? null,
    marktreferenzMiete: row.marktreferenzMiete ?? null,
    historie: row.historie ?? null,
    praesentation: row.praesentation ?? null,
    risiken: quality.riskAssessment,
    underwriting,
    profile: normalizeInvestorProfile(profileInput ?? DEFAULT_INVESTOR_PROFILE),
    analyzedAt: row.ki.analyzedAt ?? null,
    needsReview: row.listing.needsReview ?? false,
    geringstesGebotEur: row.geringstesGebotEur ?? null,
    rechteVerifiziert: row.rechteVerifiziert ?? false,
  });
  const baseBuyHold = underwriting.buyHold.find((item) => item.name === "base");
  const baseFlip = underwriting.fixFlip.find((item) => item.name === "base");
  const bearFlip = underwriting.fixFlip.find((item) => item.name === "bear");
  const maxBidCandidates = [
    strategy === "buy_hold" ? baseBuyHold?.maxBidEur : null,
    strategy === "fix_flip" ? baseFlip?.maxBidEur : null,
    strategy === "unter_markt" ? baseBuyHold?.maxBidEur : null,
  ].filter((value): value is number => value != null && value > 0);
  const nextChecks = [...quality.blockers, ...quality.warnings, ...underwriting.unknownCostItems]
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, 4);

  const base = {
    listingId: row.listing.id,
    slug: row.listing.slug,
    bundesland: row.listing.bundesland,
    strategy,
    chance,
    badges: buildBadges(strategy, row.ki, flip?.einschaetzung ?? null),
    pitch,
    umsetzung: buildUmsetzungFromDbFields(row.ki, strategy),
    massnahmen,
    risiken,
    nextChecks,
    quality,
    metrics: {
      verkehrswert,
      preisProM2: row.preisProM2,
      kategorieMedianM2: medianM2,
      discountVsMedianPct,
      marktlueckePct,
      marktreferenzStichprobe: row.marktreferenzKauf?.stichprobe ?? 0,
      mieteEur: miete.eur,
      mietHerkunft: miete.herkunft,
      flipRoiPctMin: flip?.roiPctMin ?? null,
      flipGewinnMinEur: flip?.gewinnMinEur ?? null,
      flipEinschaetzung: flip?.einschaetzung ?? null,
      cashflowYieldPct: cashflowYieldFuerZeile(row),
      terminTage: row.terminTage,
      investmentScore: (row.ki.investmentScore as InvestmentScore | null) ?? null,
      benchmarkSampleSize: benchmark.sampleSize,
      benchmarkConfidence: benchmark.confidence,
      benchmarkScope: benchmark.scope,
      analysisStatus: quality.status,
      interiorInspected: row.ki.innenbesichtigung ?? null,
      arvConfidence: row.ki.arvKonfidenz ?? null,
      baseDscr: baseBuyHold?.dscr ?? null,
      baseCashOnCashPct: baseBuyHold?.cashOnCashPct ?? null,
      baseCashflowBeforeTaxEur: baseBuyHold?.cashflowBeforeTaxEur ?? null,
      baseFlipMarginPct: baseFlip?.marginOnCostPct ?? null,
      bearFlipProfitEur: bearFlip?.profitEur ?? null,
      maxBidEur: maxBidCandidates.length > 0 ? Math.min(...maxBidCandidates) : null,
      referenceBidEur: underwriting.referenceBidEur > 0 ? underwriting.referenceBidEur : null,
      referenceBidPct: underwriting.referenceBidPct,
      underwritingProvisional: underwriting.provisional,
      unknownCostItems: underwriting.unknownCostItems,
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
      verkehrswert,
      wohnflaecheM2: row.listing.wohnflaecheM2 != null ? Number(row.listing.wohnflaecheM2) : null,
      zimmer: row.listing.zimmer != null ? String(row.listing.zimmer) : null,
      terminDate: row.listing.terminDate,
      amtsgericht: row.listing.amtsgericht,
      coverImageUrl: row.coverImageUrl,
    },
  };

  const hook = buildDealHook(base);
  const subtitle = buildDealSubtitle({ hook, risiken });

  return { ...base, hook, subtitle };
}

export function deduplicatePicks(picks: InvestorPick[]): InvestorPick[] {
  const best = new Map<string, InvestorPick>();
  for (const pick of picks) {
    const existing = best.get(pick.listingId);
    if (!existing || pick.chance.wert > existing.chance.wert) {
      best.set(pick.listingId, pick);
    }
  }
  return [...best.values()].sort((a, b) => b.chance.wert - a.chance.wert);
}

/**
 * Führt die Kennzahl, mit der die Strategie auftritt, beim unterstellten
 * Kaufpreis ins Minus? Dann taugt das Objekt nicht als Aufmacher: die Seite
 * beantwortet "welche Objekte sind heute deine Zeit wert", und ein negatives
 * Ergebnis beantwortet das nicht. Auffindbar bleibt es über die Suche, wo der
 * Hook den Preis nennt, ab dem die Rechnung aufgeht.
 */
function fuehrendeKennzahlNegativ(pick: InvestorPick): boolean {
  if (pick.strategy === "fix_flip") {
    return pick.metrics.baseFlipMarginPct != null && pick.metrics.baseFlipMarginPct <= 0;
  }
  if (pick.strategy === "buy_hold") {
    return (
      pick.metrics.baseCashflowBeforeTaxEur != null && pick.metrics.baseCashflowBeforeTaxEur < 0
    );
  }
  return false;
}

export function isExcludedFromHero(pick: InvestorPick): boolean {
  return (
    pick.strategy === "zeitnah" ||
    pick.metrics.investmentScore === "abraten" ||
    pick.chance.sondersituation ||
    pick.chance.datenreife === "unvollstaendig" ||
    pick.chance.wert <= 0 ||
    fuehrendeKennzahlNegativ(pick)
  );
}

/**
 * Der Hinweis erscheint, solange die Zahlen auf ungeprüften Annahmen beruhen.
 * Vorher hing er an der höchsten Reifestufe, die durch den Readiness-Deckel
 * strukturell nie erreicht wurde — der Hinweis stand also immer.
 */
export function hasHeroCaution(pick: InvestorPick): boolean {
  return pick.chance.datenreife !== "verifiziert" || pick.metrics.underwritingProvisional;
}

const KONFIDENZ_RANG: Record<Konfidenz, number> = {
  hoch: 3,
  mittel: 2,
  niedrig: 1,
  keine: 0,
};

function sortHeroCandidates(a: InvestorPick, b: InvestorPick): number {
  if (b.chance.wert !== a.chance.wert) return b.chance.wert - a.chance.wert;
  const konfidenz = KONFIDENZ_RANG[b.chance.konfidenz] - KONFIDENZ_RANG[a.chance.konfidenz];
  if (konfidenz !== 0) return konfidenz;
  const m2A = a.metrics.preisProM2 ?? Number.POSITIVE_INFINITY;
  const m2B = b.metrics.preisProM2 ?? Number.POSITIVE_INFINITY;
  return m2A - m2B;
}

export function selectHeroPick(picks: InvestorPick[]): InvestorPick | null {
  const eligible = deduplicatePicks(picks).filter((p) => !isExcludedFromHero(p));
  if (eligible.length === 0) return null;

  const tier1 = eligible.filter(
    (p) => p.metrics.flipEinschaetzung === "attraktiv" || p.metrics.investmentScore === "attraktiv",
  );
  const pool = tier1.length > 0 ? tier1 : eligible;
  const hero = [...pool].sort(sortHeroCandidates)[0];

  return { ...hero, heroCaution: hasHeroCaution(hero) };
}

export function selectWildcardPick(
  picks: InvestorPick[],
  usedListingIds: Set<string>,
): InvestorPick | null {
  const candidates = deduplicatePicks(picks)
    .filter((p) => !usedListingIds.has(p.listingId) && !isExcludedFromHero(p))
    .sort(sortHeroCandidates);
  return candidates[0] ?? null;
}
