import {
  DEFAULT_INVESTOR_PROFILE,
  normalizeInvestorProfile,
  type InvestorProfile,
} from "@/lib/investor-profile";
import { berechneErwerbskosten, hatDeutscheGrunderwerbsteuer } from "@/lib/utils";
import type { KaufpreisAnnahme } from "./kaufpreis";

export const UNDERWRITING_VERSION = "underwriting-v3-ein-modell";

export type UnderwritingScenarioName = "bear" | "base" | "bull";

export interface UnderwritingInputs {
  /**
   * Der zu prüfende Kaufpreis – nicht der gerichtlich festgesetzte
   * Verkehrswert. Wer `kaufpreis` mitgibt, bekommt die Beschriftung bis in die
   * UI durchgereicht; ohne Beschriftung bleibt offen, worauf sich jede Zahl
   * bezieht, und genau daran sind die drei alten Modelle auseinandergelaufen.
   */
  purchasePriceEur: number;
  kaufpreis?: KaufpreisAnnahme | null;
  acquisitionCostsEur: number;
  /** ZVG-Verzinsung ist affin zum Gebot — ohne Land bleibt die lineare Näherung. */
  bundesland?: string | null;
  courtValueEur?: number | null;
  referenceBidPct?: number | null;
  survivingRightsEur?: number | null;
  possessionReserveEur?: number | null;
  riskReserveEur?: number | null;
  auctionTermsVerified?: boolean;
  unknownCostItems?: string[];
  monthlyRentEur?: number | null;
  monthlyHausgeldEur?: number | null;
  livingAreaM2?: number | null;
  renovationMinEur?: number | null;
  renovationMaxEur?: number | null;
  arvMinEur?: number | null;
  arvMaxEur?: number | null;
  holdingMonths?: number | null;
}

export interface BuyHoldScenarioResult {
  name: UnderwritingScenarioName;
  monthlyRentEur: number;
  annualGrossRentEur: number;
  annualNoiEur: number;
  grossYieldPct: number;
  noiYieldPct: number;
  annualDebtServiceEur: number;
  equityRequiredEur: number;
  cashflowBeforeTaxEur: number;
  dscr: number | null;
  cashOnCashPct: number | null;
  breakEvenMonthlyRentEur: number;
  maxBidEur: number | null;
}

export interface FixFlipScenarioResult {
  name: UnderwritingScenarioName;
  arvEur: number;
  renovationEur: number;
  holdingMonths: number;
  totalInvestmentEur: number;
  equityRequiredEur: number;
  profitEur: number;
  marginOnCostPct: number;
  roiPct: number;
  annualizedRoiPct: number | null;
  breakEvenArvEur: number;
  maxBidEur: number | null;
}

export interface BidCurvePoint {
  bidPct: number;
  bidEur: number;
  buyHoldCashOnCashPct: number | null;
  buyHoldDscr: number | null;
  buyHoldCashflowEur: number | null;
  flipProfitEur: number | null;
  flipMarginPct: number | null;
}

export interface InvestmentUnderwriting {
  buyHold: BuyHoldScenarioResult[];
  fixFlip: FixFlipScenarioResult[];
  courtValueEur: number | null;
  kaufpreis: KaufpreisAnnahme | null;
  referenceBidEur: number;
  referenceBidPct: number | null;
  provisional: boolean;
  unknownCostItems: string[];
  bidCurve: BidCurvePoint[];
  profile: InvestorProfile;
  version: string;
}

const SCENARIO_FACTORS: Record<
  UnderwritingScenarioName,
  {
    rent: number;
    vacancyDelta: number;
    interestDelta: number;
    renovation: number;
    arv: number;
    holding: number;
  }
> = {
  bear: {
    rent: 0.9,
    vacancyDelta: 4,
    interestDelta: 1.5,
    renovation: 1.15,
    arv: 0.9,
    holding: 1.35,
  },
  base: {
    rent: 1,
    vacancyDelta: 0,
    interestDelta: 0,
    renovation: 1,
    arv: 1,
    holding: 1,
  },
  bull: {
    rent: 1.05,
    vacancyDelta: -2,
    interestDelta: -0.5,
    renovation: 0.9,
    arv: 1.05,
    holding: 0.85,
  },
};

function safeNumber(value: number | null | undefined, fallback = 0): number {
  return value != null && Number.isFinite(value) ? value : fallback;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function purchaseCostRate(inputs: UnderwritingInputs): number {
  if (inputs.purchasePriceEur <= 0) return 0;
  return Math.max(0, inputs.acquisitionCostsEur / inputs.purchasePriceEur);
}

export function acquisitionCostsForBid(inputs: UnderwritingInputs, bid: number): number {
  if (!(bid > 0) || !Number.isFinite(bid)) return 0;
  const court =
    inputs.courtValueEur != null && inputs.courtValueEur > 0 ? inputs.courtValueEur : null;
  if (court != null && hatDeutscheGrunderwerbsteuer(inputs.bundesland)) {
    return berechneErwerbskosten(court, bid, inputs.bundesland).gesamt;
  }
  if (inputs.purchasePriceEur <= 0) return 0;
  return Math.max(0, bid * purchaseCostRate(inputs));
}

function fixedAuctionCosts(inputs: UnderwritingInputs): number {
  return (
    safeNumber(inputs.survivingRightsEur) +
    safeNumber(inputs.possessionReserveEur) +
    safeNumber(inputs.riskReserveEur)
  );
}

function binarySearchMaxBid(
  isAcceptable: (bid: number) => boolean,
  upperBound: number,
): number | null {
  if (!Number.isFinite(upperBound) || upperBound <= 0) return null;
  let low = 0;
  let high = upperBound;
  for (let i = 0; i < 60; i += 1) {
    const mid = (low + high) / 2;
    if (isAcceptable(mid)) low = mid;
    else high = mid;
  }
  return Math.max(0, Math.round(low));
}

function calculateBuyHoldScenario(
  name: UnderwritingScenarioName,
  inputs: UnderwritingInputs,
  profile: InvestorProfile,
): BuyHoldScenarioResult | null {
  const baseRent = safeNumber(inputs.monthlyRentEur);
  if (baseRent <= 0 || inputs.purchasePriceEur <= 0) return null;
  const factors = SCENARIO_FACTORS[name];
  const monthlyRentEur = baseRent * factors.rent;
  const annualGrossRentEur = monthlyRentEur * 12;
  const vacancyPct = Math.max(0, profile.vacancyPct + factors.vacancyDelta);
  const livingArea = safeNumber(inputs.livingAreaM2);
  const nonRecoverableHausgeld = safeNumber(inputs.monthlyHausgeldEur) * 0.3 * 12;
  const maintenance = livingArea * profile.maintenanceEurM2Year;
  const vacancy = (annualGrossRentEur * vacancyPct) / 100;
  const annualNoiEur = annualGrossRentEur - vacancy - nonRecoverableHausgeld - maintenance;
  const renovationReserve =
    (safeNumber(inputs.renovationMinEur) + safeNumber(inputs.renovationMaxEur)) / 2;
  const fixedCapital = fixedAuctionCosts(inputs) + renovationReserve;
  const totalCost = inputs.purchasePriceEur + inputs.acquisitionCostsEur + fixedCapital;
  const equity = (totalCost * profile.equityPct) / 100;
  const loan = Math.max(0, totalCost - equity);
  const interestRate = Math.max(0, profile.financingRatePct + factors.interestDelta);
  const annualDebtServiceEur = (loan * (interestRate + profile.repaymentRatePct)) / 100;
  const cashflowBeforeTaxEur = annualNoiEur - annualDebtServiceEur;
  const dscr = annualDebtServiceEur > 0 ? annualNoiEur / annualDebtServiceEur : null;
  const cashOnCashPct = equity > 0 ? (cashflowBeforeTaxEur / equity) * 100 : null;
  const fixedOpex = nonRecoverableHausgeld + maintenance;
  const effectiveRentFactor = Math.max(0.01, 1 - vacancyPct / 100);
  const breakEvenMonthlyRentEur = (annualDebtServiceEur + fixedOpex) / effectiveRentFactor / 12;
  const maxBidEur = binarySearchMaxBid(
    (bid) => {
      const candidateTotal = bid + acquisitionCostsForBid(inputs, bid) + fixedCapital;
      const candidateEquity = (candidateTotal * profile.equityPct) / 100;
      const candidateLoan = candidateTotal - candidateEquity;
      const debtService = (candidateLoan * (interestRate + profile.repaymentRatePct)) / 100;
      const candidateDscr = debtService > 0 ? annualNoiEur / debtService : Number.POSITIVE_INFINITY;
      const candidateCashflow = annualNoiEur - debtService;
      const coc =
        candidateEquity > 0
          ? (candidateCashflow / candidateEquity) * 100
          : Number.POSITIVE_INFINITY;
      return (
        candidateEquity <= profile.maxEquityEur &&
        candidateDscr >= profile.minDscr &&
        coc >= profile.targetCashOnCashPct
      );
    },
    Math.max(inputs.purchasePriceEur * 3, annualNoiEur * 50),
  );

  return {
    name,
    monthlyRentEur: Math.round(monthlyRentEur),
    annualGrossRentEur: Math.round(annualGrossRentEur),
    annualNoiEur: Math.round(annualNoiEur),
    grossYieldPct: round((annualGrossRentEur / totalCost) * 100),
    noiYieldPct: round((annualNoiEur / totalCost) * 100),
    annualDebtServiceEur: Math.round(annualDebtServiceEur),
    equityRequiredEur: Math.round(equity),
    cashflowBeforeTaxEur: Math.round(cashflowBeforeTaxEur),
    dscr: dscr == null ? null : round(dscr),
    cashOnCashPct: cashOnCashPct == null ? null : round(cashOnCashPct),
    breakEvenMonthlyRentEur: Math.round(breakEvenMonthlyRentEur),
    maxBidEur,
  };
}

function calculateFixFlipScenario(
  name: UnderwritingScenarioName,
  inputs: UnderwritingInputs,
  profile: InvestorProfile,
): FixFlipScenarioResult | null {
  const baseArv =
    name === "bear"
      ? safeNumber(inputs.arvMinEur)
      : name === "bull"
        ? safeNumber(inputs.arvMaxEur)
        : (safeNumber(inputs.arvMinEur) + safeNumber(inputs.arvMaxEur)) / 2;
  if (baseArv <= 0 || inputs.purchasePriceEur <= 0) return null;
  const baseRenovation =
    name === "bear"
      ? safeNumber(inputs.renovationMaxEur)
      : name === "bull"
        ? safeNumber(inputs.renovationMinEur)
        : (safeNumber(inputs.renovationMinEur) + safeNumber(inputs.renovationMaxEur)) / 2;
  const factors = SCENARIO_FACTORS[name];
  const arvEur = baseArv * factors.arv;
  const renovationEur = baseRenovation * 1.1 * factors.renovation;
  const holdingMonths = Math.max(
    1,
    Math.round(safeNumber(inputs.holdingMonths, profile.maxHoldingMonths) * factors.holding),
  );
  const interestRate = Math.max(0, profile.financingRatePct + factors.interestDelta);
  const saleCostRate = 0.05;
  const fixedCapital = fixedAuctionCosts(inputs);

  const calculate = (bid: number) => {
    const acquisitionCosts = acquisitionCostsForBid(inputs, bid);
    const financingBase = bid + renovationEur + acquisitionCosts + fixedCapital;
    const holdingCosts = (((financingBase * interestRate) / 100) * holdingMonths) / 12;
    const sellingCosts = arvEur * saleCostRate;
    const totalInvestmentEur = bid + acquisitionCosts + renovationEur + fixedCapital + holdingCosts;
    const equityRequiredEur = (financingBase * profile.equityPct) / 100;
    const profitEur = arvEur - sellingCosts - totalInvestmentEur;
    const marginOnCostPct = totalInvestmentEur > 0 ? (profitEur / totalInvestmentEur) * 100 : 0;
    return {
      totalInvestmentEur,
      equityRequiredEur,
      profitEur,
      marginOnCostPct,
      sellingCosts,
    };
  };

  const current = calculate(inputs.purchasePriceEur);
  const maxBidEur = binarySearchMaxBid((bid) => {
    const candidate = calculate(bid);
    return (
      candidate.equityRequiredEur <= profile.maxEquityEur &&
      candidate.marginOnCostPct >= profile.targetFlipMarginPct
    );
  }, arvEur);
  const roiPct = current.marginOnCostPct;
  const annualizedRoiPct =
    holdingMonths > 0 && roiPct > -100
      ? (Math.pow(1 + roiPct / 100, 12 / holdingMonths) - 1) * 100
      : null;

  return {
    name,
    arvEur: Math.round(arvEur),
    renovationEur: Math.round(renovationEur),
    holdingMonths,
    totalInvestmentEur: Math.round(current.totalInvestmentEur),
    equityRequiredEur: Math.round(current.equityRequiredEur),
    profitEur: Math.round(current.profitEur),
    marginOnCostPct: round(current.marginOnCostPct),
    roiPct: round(roiPct),
    annualizedRoiPct: annualizedRoiPct == null ? null : round(annualizedRoiPct),
    breakEvenArvEur: Math.round(current.totalInvestmentEur / (1 - saleCostRate)),
    maxBidEur,
  };
}

export function calculateInvestmentUnderwriting(
  inputs: UnderwritingInputs,
  profileInput?: Partial<InvestorProfile> | null,
): InvestmentUnderwriting {
  const profile = normalizeInvestorProfile(profileInput ?? DEFAULT_INVESTOR_PROFILE);
  const scenarioNames: UnderwritingScenarioName[] = ["bear", "base", "bull"];
  const courtValueEur =
    inputs.courtValueEur != null && inputs.courtValueEur > 0 ? inputs.courtValueEur : null;
  const referenceBidPct =
    inputs.referenceBidPct != null
      ? inputs.referenceBidPct
      : courtValueEur != null
        ? (inputs.purchasePriceEur / courtValueEur) * 100
        : null;
  const bidCurve: BidCurvePoint[] =
    courtValueEur == null
      ? []
      : [50, 60, 70, 80, 100].map((bidPct) => {
          const bidEur = (courtValueEur * bidPct) / 100;
          const curveInputs: UnderwritingInputs = {
            ...inputs,
            purchasePriceEur: bidEur,
            acquisitionCostsEur: acquisitionCostsForBid(inputs, bidEur),
          };
          const buyHold = calculateBuyHoldScenario("base", curveInputs, profile);
          const fixFlip = calculateFixFlipScenario("base", curveInputs, profile);
          return {
            bidPct,
            bidEur: Math.round(bidEur),
            buyHoldCashOnCashPct: buyHold?.cashOnCashPct ?? null,
            buyHoldDscr: buyHold?.dscr ?? null,
            buyHoldCashflowEur: buyHold?.cashflowBeforeTaxEur ?? null,
            flipProfitEur: fixFlip?.profitEur ?? null,
            flipMarginPct: fixFlip?.marginOnCostPct ?? null,
          };
        });

  return {
    buyHold: scenarioNames
      .map((name) => calculateBuyHoldScenario(name, inputs, profile))
      .filter((item): item is BuyHoldScenarioResult => item != null),
    fixFlip: scenarioNames
      .map((name) => calculateFixFlipScenario(name, inputs, profile))
      .filter((item): item is FixFlipScenarioResult => item != null),
    courtValueEur,
    kaufpreis: inputs.kaufpreis ?? null,
    referenceBidEur: Math.round(inputs.purchasePriceEur),
    referenceBidPct: referenceBidPct == null ? null : round(referenceBidPct, 1),
    provisional: inputs.auctionTermsVerified !== true,
    unknownCostItems: [...new Set(inputs.unknownCostItems ?? [])],
    bidCurve,
    profile,
    version: UNDERWRITING_VERSION,
  };
}
