import { NextRequest, NextResponse } from "next/server";
import { befoerdereKandidaten } from "@/lib/market-candidates";
import { rejectIfCronUnauthorized } from "@/lib/cron-auth";

export async function POST(request: NextRequest) {
  const cronDenied = rejectIfCronUnauthorized(request, "jobs");
  if (cronDenied) return cronDenied;

  try {
    return NextResponse.json(await befoerdereKandidaten());
  } catch (error) {
    console.error("[POST /api/cron/market-candidates]", error);
    return NextResponse.json({ error: "Kandidaten-Beförderung fehlgeschlagen." }, { status: 503 });
  }
}
