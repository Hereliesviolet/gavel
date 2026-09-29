import type { PeerBenchmark } from "@/lib/investor-benchmarks";
import { assessInvestorRisks, type InvestorRiskAssessment } from "@/lib/investor-risk";
import { ANALYSE_MAX_ALTER_TAGE } from "@/lib/investor-signals";
import { isUpcomingTermin } from "@/lib/utils";

export const INVESTOR_QUALITY_RULES_VERSION = "investor-quality-v3";
export const INVESTOR_ANALYSIS_MAX_AGE_DAYS = ANALYSE_MAX_ALTER_TAGE;
export const UNINSPECTED_RENOVATION_RESERVE_EUR_M2 = 500;

export type InvestorAnalysisStatus =
  | "ready"
  | "insufficient_data"
  | "needs_review"
  | "market_data_missing"
  | "stale"
  | "not_applicable";

export interface StrategyEligibility {
  buyHold: boolean;
  fixFlip: boolean;
  unterMarkt: boolean;
  zeitnah: boolean;
  reasons: string[];
}

/**
 * Prüfergebnis ohne eigenen Score. `qualityScore` und `confidence` sind
 * entfallen: Evidenzvollständigkeit wird jetzt einmal als Datenreife und
 * Konfidenz in investor-signals.ts ausgedrückt, statt hier ein drittes Mal
 * mit abweichenden Schwellen.
 */
export interface InvestorQualityResult {
  status: InvestorAnalysisStatus;
  blockers: string[];
  warnings: string[];
  eligibility: StrategyEligibility;
  riskAssessment: InvestorRiskAssessment;
  rulesVersion: string;
}

export interface InvestorQualityInput {
  listing: {
    verkehrswert?: number | string | null;
    wohnflaecheM2?: number | string | null;
    terminDate?: Date | string | null;
    needsReview?: boolean | null;
    dataQualityFlags?: unknown;
  };
  ki: {
    moeglicherKaltmiete?: number | string | null;
    hausgeld?: number | string | null;
    fixFlipMassnahmen?: unknown;
    fixFlipGesamtkostenMinEur?: number | string | null;
    fixFlipGesamtkostenMaxEur?: number | string | null;
    arvMinEur?: number | string | null;
    arvMaxEur?: number | string | null;
    arvKonfidenz?: string | null;
    innenbesichtigung?: boolean | null;
    risikenInvestor?: unknown;
    analyzedAt?: Date | string | null;
  };
  /**
   * Flip-Kennzahlen aus dem Underwriting. Früher standen sie als Spalten in
   * der Datenbank und wurden mit einer anderen Kaufpreisannahme gerechnet als
   * das Underwriting — die Gates konnten deshalb einem Ergebnis widersprechen,
   * das die UI daneben anzeigte.
   */
  flip?: {
    roiPctMin?: number | null;
    roiPctMax?: number | null;
    einschaetzung?: string | null;
  } | null;
  preisProM2?: number | null;
  benchmark?: PeerBenchmark | null;
  /** Angezeigte Mietbasis (Marktmiete vor Gutachten). Fehlt sie, gilt die Gutachtenmiete. */
  monthlyRentEur?: number | null;
  /** Angebots-Marktlücke; ohne Wert bleibt der Peer-Abschlag die Unter-Markt-Basis. */
  marktlueckePct?: number | null;
  now?: Date;
}

function finite(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function hasCriticalDataQualityFlag(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((flag) => {
    if (!flag || typeof flag !== "object") return false;
    const severity = String((flag as Record<string, unknown>).severity ?? "").toLowerCase();
    return severity === "critical";
  });
}

function isOlderThan(value: Date | string | null | undefined, now: Date, days: number): boolean {
  if (!value) return false;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return now.getTime() - date.getTime() > days * 24 * 60 * 60 * 1_000;
}

export function evaluateInvestorQuality(input: InvestorQualityInput): InvestorQualityResult {
  const now = input.now ?? new Date();
  const blockers: string[] = [];
  const warnings: string[] = [];
  const reasons: string[] = [];
  const verkehrswert = finite(input.listing.verkehrswert);
  const wohnflaeche = finite(input.listing.wohnflaecheM2);
  const miete = finite(input.monthlyRentEur) ?? finite(input.ki.moeglicherKaltmiete);
  const hausgeld = finite(input.ki.hausgeld);
  const renovationMin = finite(input.ki.fixFlipGesamtkostenMinEur);
  const renovationMax = finite(input.ki.fixFlipGesamtkostenMaxEur);
  const arvMin = finite(input.ki.arvMinEur);
  const arvMax = finite(input.ki.arvMaxEur);
  const roiMin = finite(input.flip?.roiPctMin);
  const roiMax = finite(input.flip?.roiPctMax);
  const riskAssessment = assessInvestorRisks(input.ki.risikenInvestor);
  const analysisStale = isOlderThan(input.ki.analyzedAt, now, INVESTOR_ANALYSIS_MAX_AGE_DAYS);
  if (analysisStale) {
    warnings.push(`KI-Analyse ist älter als ${INVESTOR_ANALYSIS_MAX_AGE_DAYS} Tage.`);
  }

  if (input.listing.needsReview || hasCriticalDataQualityFlag(input.listing.dataQualityFlags)) {
    blockers.push("Datenqualität muss vor einer Investmentbewertung geprüft werden.");
  }
  if (verkehrswert == null || verkehrswert < 1_000) {
    blockers.push("Keine belastbare Kaufpreis-/Verkehrswertbasis.");
  }
  if (wohnflaeche != null && (wohnflaeche <= 5 || wohnflaeche > 10_000)) {
    blockers.push("Wohnfläche außerhalb des plausiblen Bereichs.");
  }
  if (riskAssessment.critical.length > 0) {
    blockers.push(
      `Kritisches Transaktionsrisiko muss vor einer Empfehlung geklärt werden: ${riskAssessment.critical[0]}`,
    );
  }
  if (riskAssessment.material.length > 0) {
    warnings.push(
      riskAssessment.material.length === 1
        ? "1 materielles Investmentrisiko vor Gebot verifizieren."
        : `${riskAssessment.material.length} materielle Investmentrisiken vor Gebot verifizieren.`,
    );
  }
  if (input.ki.innenbesichtigung === false) {
    warnings.push("Keine Innenbesichtigung: Zustand und Sanierungsreserve sind unsicher.");
  }

  let rentPlausible = false;
  if (miete != null && miete > 0 && verkehrswert != null && verkehrswert > 0) {
    const grossYield = ((miete * 12) / verkehrswert) * 100;
    rentPlausible = grossYield >= 0.5 && grossYield <= 25;
    if (!rentPlausible) {
      warnings.push("Mietannahme erzeugt eine unplausible Bruttomietrendite.");
    }
    if (hausgeld != null && hausgeld < 0) {
      warnings.push("Hausgeld darf nicht negativ sein.");
      rentPlausible = false;
    }
  }

  const hasMeasures = arrayLength(input.ki.fixFlipMassnahmen) > 0;
  const renovationPlausible =
    renovationMin != null &&
    renovationMax != null &&
    renovationMin > 0 &&
    renovationMax >= renovationMin;
  if (hasMeasures && !renovationPlausible) {
    warnings.push("Sanierungsumfang ist nicht als plausibles Kostenintervall belegt.");
  }
  const uninspectedReservePlausible =
    input.ki.innenbesichtigung !== false ||
    wohnflaeche == null ||
    wohnflaeche <= 0 ||
    (renovationMax != null && renovationMax >= wohnflaeche * UNINSPECTED_RENOVATION_RESERVE_EUR_M2);
  if (hasMeasures && !uninspectedReservePlausible) {
    warnings.push(
      `Ohne Innenbesichtigung fehlen mindestens ${UNINSPECTED_RENOVATION_RESERVE_EUR_M2} €/m² belastbare Sanierungsreserve.`,
    );
  }
  let arvPlausible =
    arvMin != null &&
    arvMax != null &&
    arvMin > 0 &&
    arvMax >= arvMin &&
    verkehrswert != null &&
    verkehrswert >= 1_000;
  if (arvPlausible && verkehrswert != null) {
    const minRatio = arvMin! / verkehrswert;
    const maxRatio = arvMax! / verkehrswert;
    if (minRatio < 0.25 || maxRatio > 5) {
      arvPlausible = false;
      warnings.push("ARV weicht ohne belastbare Vergleichsevidenz extrem vom Verkehrswert ab.");
    }
  }
  if (roiMin != null && roiMax != null && roiMax < roiMin) {
    arvPlausible = false;
    warnings.push("Flip-ROI-Intervall ist widersprüchlich.");
  }
  if (hasMeasures && input.ki.arvKonfidenz === "niedrig") {
    warnings.push(
      "Der ARV ist nur mit niedriger Konfidenz geschätzt; die Flip-Rechnung trägt keine Entscheidung.",
    );
  }
  if (renovationMax != null && arvMax != null && arvMax > 0 && renovationMax > arvMax) {
    warnings.push(
      "Geschätzte Sanierungskosten übersteigen den geschätzten Verkaufswert nach Sanierung.",
    );
  }

  const globalEligible = blockers.length === 0 && !analysisStale;
  const buyHold = globalEligible && rentPlausible;
  const fixFlip =
    globalEligible &&
    hasMeasures &&
    renovationPlausible &&
    uninspectedReservePlausible &&
    arvPlausible &&
    input.flip?.einschaetzung !== "abraten" &&
    roiMin != null &&
    roiMin >= 5 &&
    (input.ki.arvKonfidenz === "mittel" || input.ki.arvKonfidenz === "hoch");
  const benchmarkDiscountPct =
    input.preisProM2 != null &&
    input.preisProM2 > 0 &&
    input.benchmark?.sufficient &&
    input.benchmark.medianEurM2 != null &&
    input.benchmark.medianEurM2 > 0
      ? (1 - input.preisProM2 / input.benchmark.medianEurM2) * 100
      : null;
  const marketGapPct = finite(input.marktlueckePct) ?? benchmarkDiscountPct;
  const contradictoryNegativeFlip =
    (input.flip?.einschaetzung === "abraten" || (roiMin != null && roiMin < 0)) && !buyHold;
  const unterMarkt =
    globalEligible && marketGapPct != null && marketGapPct > 0 && !contradictoryNegativeFlip;
  const zeitnah = globalEligible && isUpcomingTermin(input.listing.terminDate, now);

  if (!buyHold) reasons.push("Buy & Hold: belastbare Miet-/Kostenbasis fehlt.");
  if (!fixFlip) {
    reasons.push(
      "Fix & Flip: belastbarer ARV, positive konservative Marge oder dokumentierte Maßnahmen fehlen.",
    );
  }
  if (!unterMarkt) {
    reasons.push(
      contradictoryNegativeFlip
        ? "Unter Markt: Preisabschlag wird durch ein negatives Investment-Szenario widersprochen."
        : "Unter Markt: positiver Abschlag oder ausreichende Vergleichsgruppe fehlt.",
    );
  }
  if (!zeitnah) reasons.push("Zeitnah: kein zukünftiger Termin.");

  let status: InvestorAnalysisStatus = "ready";
  if (blockers.length > 0) {
    status = "needs_review";
  } else if (analysisStale) {
    status = "stale";
  } else if (!buyHold && !fixFlip && !unterMarkt) {
    status =
      input.benchmark && !input.benchmark.sufficient ? "market_data_missing" : "insufficient_data";
  }

  return {
    status,
    blockers,
    warnings,
    eligibility: { buyHold, fixFlip, unterMarkt, zeitnah, reasons },
    riskAssessment,
    rulesVersion: INVESTOR_QUALITY_RULES_VERSION,
  };
}
