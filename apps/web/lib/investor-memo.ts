import type { PeerBenchmark } from "@/lib/investor-benchmarks";
import {
  evaluateInvestorQuality,
  type InvestorQualityInput,
  type InvestorQualityResult,
} from "@/lib/investor-quality";
import {
  calculateInvestmentUnderwriting,
  flipKennzahlen,
  type InvestmentUnderwriting,
  type UnderwritingInputs,
} from "@/lib/underwriting";
import type { InvestorProfile } from "@/lib/investor-profile";

export type InvestmentMemoDecision =
  "weiter_pruefen" | "beobachten" | "ausscheiden" | "nicht_bewertbar";

export type InvestmentEvidenceKind =
  "official_document" | "listing_source" | "peer_benchmark" | "model_output";

export interface InvestmentEvidenceSource {
  label: string;
  kind: InvestmentEvidenceKind;
  url?: string | null;
  verified: boolean;
  note?: string | null;
}

export interface InvestmentMemo {
  decision: InvestmentMemoDecision;
  headline: string;
  quality: InvestorQualityResult;
  underwriting: InvestmentUnderwriting;
  maxBidEur: number | null;
  thesis: string[];
  killCriteria: string[];
  dueDiligence: string[];
  benchmark: PeerBenchmark | null;
  sources: InvestmentEvidenceSource[];
  generatedAt: string;
}

export interface InvestmentMemoInput {
  qualityInput: InvestorQualityInput;
  underwritingInput: UnderwritingInputs;
  profile?: Partial<InvestorProfile> | null;
  investmentScore?: string | null;
  investmentReason?: string | null;
  risks?: string[] | null;
  benchmark?: PeerBenchmark | null;
  sources?: InvestmentEvidenceSource[] | null;
  generatedAt?: Date;
}

function baseScenario<T extends { name: string }>(items: T[]): T | null {
  return items.find((item) => item.name === "base") ?? null;
}

export function buildInvestmentMemo(input: InvestmentMemoInput): InvestmentMemo {
  // Erst rechnen, dann prüfen: die Flip-Gates der Qualitätsbewertung beziehen
  // sich auf dieselben Zahlen, die das Memo anzeigt.
  const underwriting = calculateInvestmentUnderwriting(input.underwritingInput, input.profile);
  const flip = flipKennzahlen(underwriting);
  const quality = evaluateInvestorQuality({
    ...input.qualityInput,
    monthlyRentEur: input.qualityInput.monthlyRentEur ?? input.underwritingInput.monthlyRentEur,
    flip,
    benchmark: input.benchmark ?? input.qualityInput.benchmark,
  });
  const baseBuyHold = baseScenario(underwriting.buyHold);
  const baseFlip = baseScenario(underwriting.fixFlip);
  const wantsBuyHold = underwriting.profile.strategies.includes("buy_hold");
  const wantsFixFlip = underwriting.profile.strategies.includes("fix_flip");
  const eligibleMaxBids = [
    quality.eligibility.buyHold && wantsBuyHold ? baseBuyHold?.maxBidEur : null,
    quality.eligibility.fixFlip && wantsFixFlip ? baseFlip?.maxBidEur : null,
  ].filter((value): value is number => value != null && value > 0);
  const maxBidEur = eligibleMaxBids.length > 0 ? Math.min(...eligibleMaxBids) : null;

  const flipViable =
    wantsFixFlip &&
    quality.eligibility.fixFlip &&
    baseFlip != null &&
    baseFlip.marginOnCostPct >= 0;
  const holdViable =
    wantsBuyHold &&
    quality.eligibility.buyHold &&
    baseBuyHold != null &&
    (baseBuyHold.dscr ?? 0) >= 1;
  const strategyConsidered =
    (wantsFixFlip && quality.eligibility.fixFlip && baseFlip != null) ||
    (wantsBuyHold && quality.eligibility.buyHold && baseBuyHold != null);

  let decision: InvestmentMemoDecision = "beobachten";
  if (quality.blockers.length > 0 || quality.status !== "ready") {
    decision = "nicht_bewertbar";
  } else if (
    input.investmentScore === "abraten" ||
    (strategyConsidered && !flipViable && !holdViable)
  ) {
    decision = "ausscheiden";
  } else if (
    (wantsBuyHold &&
      quality.eligibility.buyHold &&
      baseBuyHold != null &&
      baseBuyHold.equityRequiredEur <= underwriting.profile.maxEquityEur &&
      (baseBuyHold.dscr ?? 0) >= underwriting.profile.minDscr &&
      (baseBuyHold.cashOnCashPct ?? Number.NEGATIVE_INFINITY) >=
        underwriting.profile.targetCashOnCashPct) ||
    (wantsFixFlip &&
      quality.eligibility.fixFlip &&
      baseFlip != null &&
      baseFlip.equityRequiredEur <= underwriting.profile.maxEquityEur &&
      baseFlip.marginOnCostPct >= underwriting.profile.targetFlipMarginPct)
  ) {
    decision = "weiter_pruefen";
  }

  const thesis: string[] = [];
  if (input.investmentReason?.trim()) thesis.push(input.investmentReason.trim());
  if (baseBuyHold && quality.eligibility.buyHold && wantsBuyHold) {
    thesis.push(
      `Base Case: DSCR ${baseBuyHold.dscr?.toFixed(2) ?? "—"} und ` +
        `${baseBuyHold.cashOnCashPct?.toFixed(1) ?? "—"} % Cash-on-Cash.`,
    );
  }
  if (baseFlip && quality.eligibility.fixFlip && wantsFixFlip) {
    thesis.push(`Base Case: ${baseFlip.marginOnCostPct.toFixed(1)} % Marge auf Gesamtkosten.`);
  }
  if (input.benchmark?.sufficient && input.benchmark.medianEurM2 != null) {
    thesis.push(
      `Vergleichsgruppe: ${input.benchmark.sampleSize} aktive ZVG-Peers, ` +
        `Median ${Math.round(input.benchmark.medianEurM2).toLocaleString("de-DE")} €/m².`,
    );
  }

  const sources = [...(input.sources ?? [])];
  if (input.benchmark) {
    sources.push({
      label: `ZVG-Vergleichsgruppe (${input.benchmark.sampleSize} Objekte)`,
      kind: "peer_benchmark",
      verified: input.benchmark.reliable,
      note: input.benchmark.sufficient
        ? "Aktive Objekte gleicher Kategorie und desselben Bundeslands."
        : "Stichprobe zu klein für einen belastbaren Marktvergleich.",
    });
  }
  sources.push({
    label: `Deterministische Szenariorechnung ${underwriting.version}`,
    kind: "model_output",
    verified: true,
    note: "Reproduzierbare Berechnung aus den angezeigten Annahmen; keine externe Bewertung.",
  });

  const killCriteria = [
    ...quality.blockers,
    ...quality.warnings,
    ...underwriting.unknownCostItems.map((item) => `Offener Gebotsposten: ${item}`),
    ...(input.risks ?? []).slice(0, 5),
  ];
  if (baseBuyHold && baseBuyHold.dscr != null && baseBuyHold.dscr < 1) {
    killCriteria.push("Base-Case-NOI deckt den Schuldendienst nicht.");
  }
  if (baseFlip && baseFlip.profitEur < 0) {
    killCriteria.push("Base-Case-Flip ist nach Kosten negativ.");
  }
  if (
    wantsBuyHold &&
    baseBuyHold &&
    baseBuyHold.equityRequiredEur > underwriting.profile.maxEquityEur
  ) {
    killCriteria.push("Buy-&-Hold-Eigenkapitalbedarf überschreitet das Profil-Limit.");
  }
  if (wantsFixFlip && baseFlip && baseFlip.equityRequiredEur > underwriting.profile.maxEquityEur) {
    killCriteria.push("Flip-Eigenkapitalbedarf überschreitet das Profil-Limit.");
  }

  const dueDiligence = [
    "Geringstes Gebot und bestehenbleibende Rechte beim Gericht verifizieren.",
    "Mietstatus, Besitzübergang und Räumungsrisiko klären.",
    "Sanierungsumfang mit mindestens einem belastbaren Angebot validieren.",
    "Finanzierung und Sicherheitsleistung vor dem Termin bestätigen.",
  ];
  if (!quality.eligibility.buyHold) {
    dueDiligence.push("Marktmiete und nicht umlagefähige Bewirtschaftungskosten erheben.");
  }
  if (!quality.eligibility.fixFlip) {
    dueDiligence.push("ARV mit aktuellen, nachvollziehbaren Vergleichsobjekten belegen.");
  }

  const headline: Record<InvestmentMemoDecision, string> = {
    weiter_pruefen: "Unter den aktuellen Annahmen weiter prüfenswert",
    beobachten: "Beobachten und offene Annahmen verifizieren",
    ausscheiden: "Unter den aktuellen Annahmen nicht tragfähig",
    nicht_bewertbar: "Für eine belastbare Entscheidung fehlen Daten",
  };

  return {
    decision,
    headline: headline[decision],
    quality,
    underwriting,
    maxBidEur,
    thesis: [...new Set(thesis)].slice(0, 5),
    killCriteria: [...new Set(killCriteria)].slice(0, 8),
    dueDiligence: [...new Set(dueDiligence)],
    benchmark: input.benchmark ?? null,
    sources,
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
  };
}
