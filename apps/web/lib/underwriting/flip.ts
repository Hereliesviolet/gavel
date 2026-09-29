/**
 * Fix-&-Flip-Kennzahlen für die Anzeige, abgeleitet aus den Szenarien der
 * Engine.
 *
 * Diese Zahlen kamen früher aus scrapers/src/utils/fix_flip_calc.py und lagen
 * als Spalten in zvg_ki_analyses und real_estate_ki_analyses. Python rechnete
 * dabei mit dem vollen Verkehrswert als Kaufpreis, das Web mit einem
 * Referenzgebot — dasselbe Objekt konnte deshalb gleichzeitig "attraktive
 * Fix&Flip-Chance" (Datenbank) und negatives Underwriting (Web) anzeigen. Die
 * Spalten bleiben additiv bestehen, werden aber nicht mehr geschrieben und
 * nicht mehr gelesen.
 */

import type { FixFlipScenarioResult, InvestmentUnderwriting } from "./engine";

export type FlipEinschaetzung = "attraktiv" | "neutral" | "abraten";

export interface FlipKennzahlen {
  gesamtinvestitionMinEur: number;
  gesamtinvestitionMaxEur: number;
  gewinnMinEur: number;
  gewinnMaxEur: number;
  roiPctMin: number;
  roiPctMax: number;
  haltedauerMonate: number;
  haltedauerMonateMin: number;
  haltedauerMonateMax: number;
  einschaetzung: FlipEinschaetzung;
  begruendung: string;
}

function szenario(
  underwriting: InvestmentUnderwriting,
  name: FixFlipScenarioResult["name"],
): FixFlipScenarioResult | undefined {
  return underwriting.fixFlip.find((s) => s.name === name);
}

function eur(wert: number): string {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(wert);
}

function pct(wert: number): string {
  return wert.toFixed(1).replace(".", ",");
}

export function flipKennzahlen(underwriting: InvestmentUnderwriting): FlipKennzahlen | null {
  const bear = szenario(underwriting, "bear");
  const bull = szenario(underwriting, "bull");
  if (!bear || !bull) return null;

  const einschaetzung: FlipEinschaetzung =
    bear.profitEur < 0
      ? "abraten"
      : bear.marginOnCostPct >= 15
        ? "attraktiv"
        : bear.marginOnCostPct >= 5
          ? "neutral"
          : "abraten";

  const holdMin = Math.min(bull.holdingMonths, bear.holdingMonths);
  const holdMax = Math.max(bull.holdingMonths, bear.holdingMonths);
  const holdLabel = holdMin === holdMax ? `${holdMax}` : `${holdMin}–${holdMax}`;

  return {
    gesamtinvestitionMinEur: bull.totalInvestmentEur,
    gesamtinvestitionMaxEur: bear.totalInvestmentEur,
    gewinnMinEur: bear.profitEur,
    gewinnMaxEur: bull.profitEur,
    roiPctMin: bear.marginOnCostPct,
    roiPctMax: bull.marginOnCostPct,
    haltedauerMonate: bear.holdingMonths,
    haltedauerMonateMin: holdMin,
    haltedauerMonateMax: holdMax,
    einschaetzung,
    begruendung:
      `Gewinn ${eur(bear.profitEur)}–${eur(bull.profitEur)} € bei einer Marge von ` +
      `${pct(bear.marginOnCostPct)}–${pct(bull.marginOnCostPct)} % über ` +
      `${holdLabel} Monate.`,
  };
}
