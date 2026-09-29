import type { FixFlipMassnahme } from "@/components/zvg/detail/ki-sections/investment-fixflip";
import type {
  InvestorPick,
  InvestorPickKiFields,
  InvestorPickRow,
  InvestmentScore,
  EinstiegTyp,
} from "@/lib/investor-picks";
import { buildDealHook, rowToInvestorPick, selectDiscoveryStrategy } from "@/lib/investor-picks";
import { assessInvestorRisks, isAntiSignal } from "@/lib/investor-risk";
import {
  DEFAULT_INVESTOR_PROFILE,
  normalizeInvestorProfile,
  type InvestorProfile,
} from "@/lib/investor-profile";

export const EINSTIEG_MIN_VW = Number(process.env.EINSTIEG_MIN_VW ?? 25_000);
export const EINSTIEG_MAX_VW = Number(process.env.EINSTIEG_MAX_VW ?? 350_000);
/** Mindest-Chance, damit ein Objekt als Einstiegskandidat gilt. */
export const EINSTIEG_MIN_CHANCE = Number(process.env.EINSTIEG_MIN_CHANCE ?? 25);

export type EinstiegEnrichedFields = {
  einstiegTyp: EinstiegTyp;
  geschaetzteGesamtinvestition: number | null;
  erwarteteErsparnisEur: number | null;
  hardRisikoCount: number;
};

export function countHardRisks(risiken: string[]): number {
  return risiken.filter(isAntiSignal).length;
}

export function geschaetzteGesamtinvestition(
  vw: number | null,
  sanierungMax: number | null | undefined,
): number | null {
  if (vw == null) return null;
  if (sanierungMax == null || sanierungMax <= 0) return vw;
  return vw + sanierungMax;
}

export function erwarteteErsparnisEur(
  vw: number | null,
  flaecheM2: number | null,
  medianM2: number | null,
): number | null {
  if (vw == null || flaecheM2 == null || medianM2 == null || medianM2 <= 0) return null;
  const marktWert = medianM2 * flaecheM2;
  const saving = marktWert - vw;
  return saving > 0 ? Math.round(saving) : null;
}

function parseRisiken(ki: InvestorPickKiFields): string[] {
  const raw = ki.risikenInvestor;
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is string => typeof r === "string" && r.trim().length > 0);
}

function hasSanierungBeherrschbar(
  vw: number | null,
  massnahmen: FixFlipMassnahme[],
  gesamtkostenMax: number | null | undefined,
): boolean {
  if (massnahmen.length === 0) return true;
  if (vw == null || vw <= 0) return false;
  if (gesamtkostenMax != null && gesamtkostenMax > 0) {
    return gesamtkostenMax <= vw * 0.4;
  }
  const sumMax = massnahmen.reduce((s, m) => s + (m.kosten_max_eur ?? 0), 0);
  if (sumMax <= 0) return true;
  return sumMax <= vw * 0.4;
}

/**
 * Einstiegstauglichkeit: enge Objektgroesse, beherrschbare Sanierung, kein
 * Anti-Signal und eine Chance oberhalb der Mindestschwelle.
 *
 * Der frueher hier berechnete einstiegScore ist entfallen. Er war ein sechster
 * paralleler Score mit eigenen Gewichten und liess sich mit den uebrigen nicht
 * vergleichen; die Reihenfolge kommt jetzt aus derselben Chance wie ueberall.
 */
export function passesEinstiegCriteria(
  row: InvestorPickRow,
  profileInput?: Partial<InvestorProfile> | null,
): boolean {
  const profile = normalizeInvestorProfile(profileInput ?? DEFAULT_INVESTOR_PROFILE);
  const vw = row.listing.verkehrswert != null ? Number(row.listing.verkehrswert) : null;
  if (vw == null || vw < EINSTIEG_MIN_VW || vw > EINSTIEG_MAX_VW) return false;
  if (row.ki.investmentScore === "abraten") return false;
  if (row.terminTage == null || row.terminTage <= 14) return false;

  const massnahmen = row.ki.fixFlipMassnahmen ?? [];
  const gesamtMax = row.ki.fixFlipGesamtkostenMaxEur ?? null;
  if (!hasSanierungBeherrschbar(vw, massnahmen, gesamtMax)) return false;

  const assessment = assessInvestorRisks(parseRisiken(row.ki));
  if (assessment.critical.length > 0) return false;
  const allowedMaterialRisks =
    profile.riskTolerance === "opportunistic" ? 2 : profile.riskTolerance === "balanced" ? 1 : 0;
  if (assessment.material.length > allowedMaterialRisks) return false;

  const pick = rowToInvestorPick(row, "unter_markt", profile);
  return pick.chance.datenreife !== "unvollstaendig" && pick.chance.wert >= EINSTIEG_MIN_CHANCE;
}

export function deriveEinstiegTyp(row: InvestorPickRow): EinstiegTyp {
  const signals: EinstiegTyp[] = [];
  const metrics = rowToInvestorPick(row, "fix_flip").metrics;
  const roi = metrics.flipRoiPctMin ?? 0;
  const cashflow = metrics.baseCashOnCashPct ?? 0;
  const discount = metrics.marktlueckePct ?? metrics.discountVsMedianPct ?? 0;

  if (roi >= 5) signals.push("flip");
  if (cashflow >= 3) signals.push("kapitalanlage");
  if (discount >= 10) signals.push("schnaeppchen");

  if (signals.length === 0) return "kombi";
  if (signals.length === 1) return signals[0];
  return "kombi";
}

export function buildEinstiegHook(pick: InvestorPick): string {
  const vw = pick.metrics.verkehrswert;
  const referenceBid = pick.metrics.referenceBidEur;
  const ort = pick.listing.ort ?? pick.listing.bundeslandName;
  const vwStr = vw != null ? `${Math.round(vw / 1000)}k €` : "—";
  const bidStr = referenceBid != null ? `${Math.round(referenceBid / 1000)}k €` : "—";
  const luecke = pick.metrics.marktlueckePct;
  const discount = luecke ?? pick.metrics.discountVsMedianPct;
  const steps = pick.massnahmen.length;

  if (discount != null && discount >= 10) {
    const basis = luecke != null ? "Angebotsniveau" : "ZVG-Peer-Median";
    return `${bidStr} Referenzgebot in ${ort} — gerichtlicher VW ${vwStr}, ${Math.round(discount)} % unter ${basis}${steps > 0 ? `, ${steps} Sanierungsschritte` : ""}`;
  }
  if (pick.metrics.flipRoiPctMin != null && pick.metrics.flipRoiPctMin >= 5) {
    return `${bidStr} Referenzgebot in ${ort} — ${pick.metrics.baseFlipMarginPct?.toFixed(0) ?? pick.metrics.flipRoiPctMin.toFixed(0)} % vorläufige Flip-Marge`;
  }
  if (pick.metrics.baseCashOnCashPct != null && pick.metrics.baseCashOnCashPct >= 3) {
    return `${bidStr} Referenzgebot in ${ort} — Cashflow im Gebotsszenario prüfen`;
  }
  if (pick.metrics.cashflowYieldPct != null && pick.metrics.cashflowYieldPct >= 3) {
    return `${bidStr} Referenzgebot in ${ort} — ${pick.metrics.cashflowYieldPct.toFixed(1)} % einfache Mietrendite, CoC noch prüfen`;
  }
  return buildDealHook(pick).slice(0, 90);
}

export function enrichEinstiegPick(
  row: InvestorPickRow,
  strategy: InvestorPick["strategy"] | null = null,
  profileInput?: Partial<InvestorProfile> | null,
): InvestorPick & EinstiegEnrichedFields {
  const resolvedStrategy =
    strategy && strategy !== "all" && strategy !== "wildcard"
      ? strategy
      : (selectDiscoveryStrategy(row, profileInput) ?? "unter_markt");
  const pick = rowToInvestorPick(row, resolvedStrategy, profileInput);
  const vw = pick.metrics.verkehrswert;
  const flaeche = pick.listing.wohnflaecheM2;
  const gesamtMax = row.ki.fixFlipGesamtkostenMaxEur ?? null;
  const risiken = pick.risiken;
  const hardRisikoCount = countHardRisks(risiken);

  return {
    ...pick,
    hook: buildEinstiegHook(pick),
    einstiegTyp: deriveEinstiegTyp(row),
    geschaetzteGesamtinvestition: geschaetzteGesamtinvestition(
      pick.metrics.referenceBidEur ?? vw,
      gesamtMax,
    ),
    erwarteteErsparnisEur: erwarteteErsparnisEur(vw, flaeche, pick.metrics.kategorieMedianM2),
    hardRisikoCount,
  };
}
