import type { InvestorAnalysisStatus, InvestorQualityResult } from "@/lib/investor-quality";
import type { ChanceErgebnis, Datenreife, Konfidenz } from "@/lib/investor-signals";

/**
 * Aggregiert den Bestand für die Datenbasis-Seite und /api/investor/quality.
 *
 * Die früheren Kennzahlen averageQualityScore und qualityBuckets sind
 * entfallen: sie verdichteten einen Score, den es nicht mehr gibt. An seine
 * Stelle treten die beiden Größen, die auch in der UI stehen — Chance und
 * Konfidenz — plus die Datenreife, die zeigt, woran es fehlt.
 */
export interface InvestorQualityReport {
  total: number;
  status: Record<InvestorAnalysisStatus, number>;
  datenreife: Record<Datenreife, number>;
  konfidenz: Record<Konfidenz, number>;
  eligible: {
    buyHold: number;
    fixFlip: number;
    unterMarkt: number;
    zeitnah: number;
  };
  blockerRatePct: number;
  warningRatePct: number;
  readyRatePct: number;
  averageChance: number;
  sondersituationen: number;
  /** Häufigste fehlende Datenbasis, absteigend — der Arbeitsvorrat. */
  topLuecken: { grund: string; anzahl: number }[];
  generatedAt: string;
}

export interface InvestorQualitySample {
  quality: InvestorQualityResult;
  chance: ChanceErgebnis;
}

function percentage(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 10_000) / 100;
}

export function aggregateInvestorQuality(
  samples: InvestorQualitySample[],
  generatedAt = new Date(),
): InvestorQualityReport {
  const status: InvestorQualityReport["status"] = {
    ready: 0,
    insufficient_data: 0,
    needs_review: 0,
    market_data_missing: 0,
    stale: 0,
    not_applicable: 0,
  };
  const datenreife: InvestorQualityReport["datenreife"] = {
    unvollstaendig: 0,
    bewertbar: 0,
    verifiziert: 0,
  };
  const konfidenz: InvestorQualityReport["konfidenz"] = {
    hoch: 0,
    mittel: 0,
    niedrig: 0,
    keine: 0,
  };
  const eligible: InvestorQualityReport["eligible"] = {
    buyHold: 0,
    fixFlip: 0,
    unterMarkt: 0,
    zeitnah: 0,
  };
  const luecken = new Map<string, number>();

  for (const { quality, chance } of samples) {
    status[quality.status] += 1;
    datenreife[chance.datenreife] += 1;
    konfidenz[chance.konfidenz] += 1;
    if (quality.eligibility.buyHold) eligible.buyHold += 1;
    if (quality.eligibility.fixFlip) eligible.fixFlip += 1;
    if (quality.eligibility.unterMarkt) eligible.unterMarkt += 1;
    if (quality.eligibility.zeitnah) eligible.zeitnah += 1;
    for (const luecke of chance.luecken) {
      luecken.set(luecke, (luecken.get(luecke) ?? 0) + 1);
    }
  }

  const total = samples.length;
  const blocked = samples.filter(({ quality }) => quality.blockers.length > 0).length;
  const warned = samples.filter(({ quality }) => quality.warnings.length > 0).length;
  const chanceSum = samples.reduce((sum, { chance }) => sum + chance.wert, 0);

  return {
    total,
    status,
    datenreife,
    konfidenz,
    eligible,
    blockerRatePct: percentage(blocked, total),
    warningRatePct: percentage(warned, total),
    readyRatePct: percentage(status.ready, total),
    averageChance: total === 0 ? 0 : Math.round((chanceSum / total) * 100) / 100,
    sondersituationen: samples.filter(({ chance }) => chance.sondersituation).length,
    topLuecken: [...luecken.entries()]
      .map(([grund, anzahl]) => ({ grund, anzahl }))
      .sort((a, b) => b.anzahl - a.anzahl)
      .slice(0, 8),
    generatedAt: generatedAt.toISOString(),
  };
}
