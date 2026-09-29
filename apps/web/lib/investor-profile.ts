import { findBundesland } from "@/lib/bundesland";
import { parseListingKategorien } from "@/lib/kategorien";

export type InvestorRiskTolerance = "conservative" | "balanced" | "opportunistic";
export type RenovationCapacity = "low" | "medium" | "high";
export type InvestorStrategyPreference = "buy_hold" | "fix_flip" | "unter_markt";

export interface InvestorProfile {
  strategies: InvestorStrategyPreference[];
  maxEquityEur: number;
  targetIrrPct: number;
  targetCashOnCashPct: number;
  targetFlipMarginPct: number;
  minDscr: number;
  financingRatePct: number;
  repaymentRatePct: number;
  equityPct: number;
  maxHoldingMonths: number;
  vacancyPct: number;
  maintenanceEurM2Year: number;
  regions: string[];
  propertyTypes: string[];
  renovationCapacity: RenovationCapacity;
  riskTolerance: InvestorRiskTolerance;
  profileVersion: string;
}

export const DEFAULT_INVESTOR_PROFILE: InvestorProfile = {
  strategies: ["buy_hold", "fix_flip", "unter_markt"],
  maxEquityEur: 150_000,
  targetIrrPct: 12,
  targetCashOnCashPct: 6,
  targetFlipMarginPct: 15,
  minDscr: 1.2,
  financingRatePct: 4.5,
  repaymentRatePct: 2,
  equityPct: 20,
  maxHoldingMonths: 12,
  vacancyPct: 4,
  maintenanceEurM2Year: 15,
  regions: [],
  propertyTypes: [],
  renovationCapacity: "medium",
  riskTolerance: "balanced",
  profileVersion: "investor-profile-v1",
};

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 50);
}

export function normalizeInvestorProfile(input?: Partial<InvestorProfile> | null): InvestorProfile {
  const defaults = DEFAULT_INVESTOR_PROFILE;
  const strategies = stringList(input?.strategies).filter(
    (value): value is InvestorStrategyPreference =>
      value === "buy_hold" || value === "fix_flip" || value === "unter_markt",
  );

  const riskTolerance: InvestorRiskTolerance =
    input?.riskTolerance === "conservative" || input?.riskTolerance === "opportunistic"
      ? input.riskTolerance
      : "balanced";
  const renovationCapacity: RenovationCapacity =
    input?.renovationCapacity === "low" || input?.renovationCapacity === "high"
      ? input.renovationCapacity
      : "medium";

  return {
    strategies: strategies.length > 0 ? [...new Set(strategies)] : defaults.strategies,
    maxEquityEur: clamp(input?.maxEquityEur, 0, 100_000_000, defaults.maxEquityEur),
    targetIrrPct: clamp(input?.targetIrrPct, 0, 100, defaults.targetIrrPct),
    targetCashOnCashPct: clamp(input?.targetCashOnCashPct, -100, 100, defaults.targetCashOnCashPct),
    targetFlipMarginPct: clamp(input?.targetFlipMarginPct, 0, 100, defaults.targetFlipMarginPct),
    minDscr: clamp(input?.minDscr, 0.1, 10, defaults.minDscr),
    financingRatePct: clamp(input?.financingRatePct, 0, 30, defaults.financingRatePct),
    repaymentRatePct: clamp(input?.repaymentRatePct, 0, 30, defaults.repaymentRatePct),
    equityPct: clamp(input?.equityPct, 0, 100, defaults.equityPct),
    maxHoldingMonths: Math.round(clamp(input?.maxHoldingMonths, 1, 120, defaults.maxHoldingMonths)),
    vacancyPct: clamp(input?.vacancyPct, 0, 50, defaults.vacancyPct),
    maintenanceEurM2Year: clamp(input?.maintenanceEurM2Year, 0, 500, defaults.maintenanceEurM2Year),
    regions: [
      ...new Set(
        stringList(input?.regions)
          .map((raw) => findBundesland(raw)?.slug)
          .filter((slug): slug is string => Boolean(slug)),
      ),
    ],
    propertyTypes: parseListingKategorien(stringList(input?.propertyTypes)),
    renovationCapacity,
    riskTolerance,
    profileVersion: defaults.profileVersion,
  };
}

export function isMissingInvestorProfileRelation(error: unknown): boolean {
  let current: unknown = error;
  for (let i = 0; i < 4 && current && typeof current === "object"; i++) {
    const code = "code" in current ? current.code : undefined;
    if (code === "42P01") return true;
    const message = "message" in current ? String(current.message) : "";
    if (
      /investor_profiles/i.test(message) &&
      /does not exist|undefined table|existiert nicht/i.test(message)
    ) {
      return true;
    }
    current = "cause" in current ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}
