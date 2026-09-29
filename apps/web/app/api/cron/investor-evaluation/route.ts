import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { investorEvaluationRuns } from "@/drizzle/schema";
import { generateInvestorQualityReport } from "@/lib/investor-quality-report";
import { rejectIfCronUnauthorized } from "@/lib/cron-auth";

export async function POST(request: NextRequest) {
  const cronDenied = rejectIfCronUnauthorized(request, "jobs");
  if (cronDenied) return cronDenied;

  try {
    const result = await generateInvestorQualityReport();
    const datasetVersion = `active-zvg-${result.report.generatedAt.slice(0, 10)}`;
    const [run] = await db
      .insert(investorEvaluationRuns)
      .values({
        qualityRulesVersion: result.versions.qualityRules,
        underwritingVersion: result.versions.underwriting,
        datasetVersion,
        sampleSize: result.report.total,
        status: result.report.blockerRatePct > 50 ? "warning" : "passed",
        metrics: result.report,
        notes: "Automatischer Shadow-Evaluation-Run auf aktiven ZVG-Analysen.",
      })
      .returning({ id: investorEvaluationRuns.id });
    return NextResponse.json({ runId: run?.id, ...result }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/cron/investor-evaluation]", error);
    return NextResponse.json(
      { error: "Investor-Evaluation konnte nicht gespeichert werden." },
      { status: 503 },
    );
  }
}
