import { eq } from "drizzle-orm";
import { investorProfiles } from "@/drizzle/schema";
import { db } from "@/lib/db";
import {
  DEFAULT_INVESTOR_PROFILE,
  isMissingInvestorProfileRelation,
  normalizeInvestorProfile,
  type InvestorProfile,
} from "@/lib/investor-profile";

export { isMissingInvestorProfileRelation };

export interface InvestorProfileLoadResult {
  profile: InvestorProfile;
  persisted: boolean;
}

type InvestorProfileRow = typeof investorProfiles.$inferSelect;

function fromRow(row: InvestorProfileRow): InvestorProfile {
  return normalizeInvestorProfile({
    strategies: row.strategies as InvestorProfile["strategies"],
    maxEquityEur: row.maxEquityEur,
    targetIrrPct: Number(row.targetIrrPct),
    targetCashOnCashPct: Number(row.targetCashOnCashPct),
    targetFlipMarginPct: Number(row.targetFlipMarginPct),
    minDscr: Number(row.minDscr),
    financingRatePct: Number(row.financingRatePct),
    repaymentRatePct: Number(row.repaymentRatePct),
    equityPct: Number(row.equityPct),
    maxHoldingMonths: row.maxHoldingMonths,
    vacancyPct: Number(row.vacancyPct),
    maintenanceEurM2Year: Number(row.maintenanceEurM2Year),
    regions: row.regions as string[],
    propertyTypes: row.propertyTypes as string[],
    renovationCapacity: row.renovationCapacity as InvestorProfile["renovationCapacity"],
    riskTolerance: row.riskTolerance as InvestorProfile["riskTolerance"],
  });
}

/**
 * Safe rollout: solange Migration 0018 auf einer Instanz noch nicht
 * eingespielt ist, laufen alle Investor-Seiten mit konservativen Defaults
 * weiter. Nur ein expliziter Speichervorgang benötigt die neue Tabelle.
 */
export async function getInvestorProfileWithMeta(
  userId: string,
): Promise<InvestorProfileLoadResult> {
  try {
    const row = await db.query.investorProfiles.findFirst({
      where: eq(investorProfiles.userId, userId),
    });
    return {
      profile: row ? fromRow(row) : DEFAULT_INVESTOR_PROFILE,
      persisted: Boolean(row),
    };
  } catch (error) {
    if (isMissingInvestorProfileRelation(error)) {
      console.warn("[investor-profile] Tabelle fehlt, Fallback auf Standardprofil");
      return { profile: DEFAULT_INVESTOR_PROFILE, persisted: false };
    }
    throw error;
  }
}

export async function getInvestorProfile(userId: string): Promise<InvestorProfile> {
  return (await getInvestorProfileWithMeta(userId)).profile;
}

export async function upsertInvestorProfile(
  userId: string,
  input: Partial<InvestorProfile>,
): Promise<InvestorProfile> {
  const profile = normalizeInvestorProfile(input);
  const values = {
    userId,
    strategies: profile.strategies,
    maxEquityEur: Math.round(profile.maxEquityEur),
    targetIrrPct: String(profile.targetIrrPct),
    targetCashOnCashPct: String(profile.targetCashOnCashPct),
    targetFlipMarginPct: String(profile.targetFlipMarginPct),
    minDscr: String(profile.minDscr),
    financingRatePct: String(profile.financingRatePct),
    repaymentRatePct: String(profile.repaymentRatePct),
    equityPct: String(profile.equityPct),
    maxHoldingMonths: profile.maxHoldingMonths,
    vacancyPct: String(profile.vacancyPct),
    maintenanceEurM2Year: String(profile.maintenanceEurM2Year),
    regions: profile.regions,
    propertyTypes: profile.propertyTypes,
    renovationCapacity: profile.renovationCapacity,
    riskTolerance: profile.riskTolerance,
    profileVersion: profile.profileVersion,
    updatedAt: new Date(),
  };

  const [row] = await db
    .insert(investorProfiles)
    .values(values)
    .onConflictDoUpdate({
      target: investorProfiles.userId,
      set: values,
    })
    .returning();

  if (!row) throw new Error("Investorprofil konnte nicht gespeichert werden.");
  return fromRow(row);
}
