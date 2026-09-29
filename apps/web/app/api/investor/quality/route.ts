import { NextRequest, NextResponse } from "next/server";
import { generateInvestorQualityReport } from "@/lib/investor-quality-report";
import { recordAuditEvent } from "@/lib/audit";
import { requireAdmin } from "@/lib/authz";
import { ADMIN_READ_RATE, isRateLimited, recordRateLimitHit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { session, error } = await requireAdmin();
  if (error || !session?.user?.id) {
    return NextResponse.json({ error }, { status: error === "Nicht eingeloggt" ? 401 : 403 });
  }

  const rateKey = `admin-quality:${session.user.id}`;
  if (await isRateLimited(rateKey, ADMIN_READ_RATE)) {
    return NextResponse.json({ error: "Zu viele Report-Anfragen." }, { status: 429 });
  }
  await recordRateLimitHit(rateKey, ADMIN_READ_RATE);

  try {
    const report = await generateInvestorQualityReport();
    await recordAuditEvent({
      actorId: session.user.id,
      action: "admin.quality.read",
      request: req,
    });
    return NextResponse.json(report);
  } catch (error) {
    console.error("[GET /api/investor/quality]", error);
    return NextResponse.json(
      { error: "Investor-Qualitätsreport konnte nicht geladen werden." },
      { status: 500 },
    );
  }
}
