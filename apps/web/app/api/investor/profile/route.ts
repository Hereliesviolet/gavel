import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getInvestorProfileWithMeta, upsertInvestorProfile } from "@/lib/investor-profile-storage";
import { findBundesland } from "@/lib/bundesland";
import { LISTING_KATEGORIEN } from "@/lib/kategorien";
import { isRateLimited, LIST_READ_RATE, recordRateLimitHit } from "@/lib/rate-limit";
import { rejectUntrustedMutation } from "@/lib/request-meta";
import { readJsonCapped, rejectCappedJson } from "@/lib/request-body";

const INVESTOR_PROFILE_RATE = { max: 20, windowSeconds: 10 * 60, failClosed: true };

const investorProfileSchema = z.object({
  strategies: z
    .array(z.enum(["buy_hold", "fix_flip", "unter_markt"]))
    .min(1)
    .max(3),
  maxEquityEur: z.coerce.number().min(0).max(100_000_000),
  targetIrrPct: z.coerce.number().min(0).max(100),
  targetCashOnCashPct: z.coerce.number().min(-100).max(100),
  targetFlipMarginPct: z.coerce.number().min(0).max(100),
  minDscr: z.coerce.number().min(0.1).max(10),
  financingRatePct: z.coerce.number().min(0).max(30),
  repaymentRatePct: z.coerce.number().min(0).max(30),
  equityPct: z.coerce.number().min(0).max(100),
  maxHoldingMonths: z.coerce.number().int().min(1).max(120),
  vacancyPct: z.coerce.number().min(0).max(50),
  maintenanceEurM2Year: z.coerce.number().min(0).max(500),
  regions: z
    .array(z.string().trim().min(1).max(100))
    .max(50)
    .superRefine((regions, ctx) => {
      if (regions.some((region) => !findBundesland(region))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Ungültiges Bundesland." });
      }
    }),
  propertyTypes: z.array(z.enum(LISTING_KATEGORIEN)).max(50),
  renovationCapacity: z.enum(["low", "medium", "high"]),
  riskTolerance: z.enum(["conservative", "balanced", "opportunistic"]),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });
  }

  const rateKey = `investor-profile-read:${session.user.id}`;
  if (await isRateLimited(rateKey, LIST_READ_RATE)) {
    return NextResponse.json({ error: "Zu viele Profil-Anfragen." }, { status: 429 });
  }
  await recordRateLimitHit(rateKey, LIST_READ_RATE);

  const result = await getInvestorProfileWithMeta(session.user.id);
  return NextResponse.json(result);
}

export async function PATCH(request: NextRequest) {
  const csrf = rejectUntrustedMutation(request);
  if (csrf) return csrf;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });
  }

  const rateKey = `investor-profile:${session.user.id}`;
  if (await isRateLimited(rateKey, INVESTOR_PROFILE_RATE)) {
    return NextResponse.json(
      { error: "Zu viele Profil-Änderungen. Bitte später erneut versuchen." },
      { status: 429 },
    );
  }
  await recordRateLimitHit(rateKey, INVESTOR_PROFILE_RATE);

  const json = await readJsonCapped(request);
  if (!json.ok) return rejectCappedJson(json, "Ungültige JSON-Anfrage");
  const body = json.value;

  const parsed = investorProfileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültiges Investorenprofil" }, { status: 400 });
  }

  try {
    const profile = await upsertInvestorProfile(session.user.id, parsed.data);
    return NextResponse.json({ profile, persisted: true });
  } catch (error) {
    console.error("[PATCH /api/investor/profile]", error);
    return NextResponse.json(
      { error: "Investorenprofil konnte nicht gespeichert werden." },
      { status: 503 },
    );
  }
}
