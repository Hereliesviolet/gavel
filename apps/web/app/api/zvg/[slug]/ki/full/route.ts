import { NextRequest, NextResponse } from "next/server";
import { and, count, eq, gte } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { zvgKiAnalyses } from "@/drizzle/schema";
import { findZvgListingBySlug } from "@/lib/zvg-listing-lookup";
import { isUsableZvgSlug, zvgBundeslandFromRequest } from "@/lib/zvg-documents";
import { isRateLimited, recordRateLimitHit } from "@/lib/rate-limit";
import { rejectUntrustedMutation } from "@/lib/request-meta";
import { startOfZonedDay } from "@/lib/utils";
import { FULL_KI_BURST, FULL_KI_DAILY_LIMIT, fullKiQuotaReached } from "@/lib/zvg-full-analyse";
import { isFullKiAnalysis, isKiFullPending } from "@/lib/ki-status";

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const csrf = rejectUntrustedMutation(req);
  if (csrf) return csrf;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });
  }

  const burstKey = `zvg-full-ki:${session.user.id}`;
  if (await isRateLimited(burstKey, FULL_KI_BURST)) {
    return NextResponse.json(
      { error: "Zu viele Analyse-Anfragen. Bitte kurz warten." },
      { status: 429 },
    );
  }
  await recordRateLimitHit(burstKey, FULL_KI_BURST);

  const { slug } = await params;
  if (!isUsableZvgSlug(slug)) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const listing = await findZvgListingBySlug(
    slug,
    zvgBundeslandFromRequest(req.nextUrl.searchParams.get("bundesland")),
  );
  if (!listing) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const existing = await db.query.zvgKiAnalyses.findFirst({
    where: eq(zvgKiAnalyses.listingId, listing.id),
    columns: { analysisTier: true, fullStatus: true },
  });
  if (isFullKiAnalysis(existing)) {
    return NextResponse.json({
      analysisTier: "full",
      fullStatus: "idle",
      status: "already_full",
    });
  }
  if (isKiFullPending(existing)) {
    return NextResponse.json({
      analysisTier: existing?.analysisTier ?? "basic",
      fullStatus: existing?.fullStatus,
      status: "in_progress",
    });
  }

  const [usage] = await db
    .select({ n: count() })
    .from(zvgKiAnalyses)
    .where(
      and(
        eq(zvgKiAnalyses.fullRequestedBy, session.user.id),
        gte(zvgKiAnalyses.fullRequestedAt, startOfZonedDay()),
      ),
    );
  if (fullKiQuotaReached(Number(usage?.n ?? 0))) {
    return NextResponse.json(
      { error: `Tageslimit von ${FULL_KI_DAILY_LIMIT} ausführlichen Analysen erreicht.` },
      { status: 429 },
    );
  }

  const scraperApiUrl = process.env.SCRAPER_API_URL;
  const scraperApiSecret = process.env.SCRAPER_API_SECRET;
  if (!scraperApiUrl || !scraperApiSecret) {
    console.error("[POST /api/zvg/ki/full] SCRAPER_API_URL/SCRAPER_API_SECRET fehlt");
    return NextResponse.json({ error: "Analyse-Dienst nicht verfügbar" }, { status: 503 });
  }

  try {
    const res = await fetch(`${scraperApiUrl}/internal/analyze-zvg-listing`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${scraperApiSecret}`,
      },
      body: JSON.stringify({
        listing_id: listing.id,
        requested_by: session.user.id,
      }),
    });
    const payload = (await res.json().catch(() => ({}))) as {
      status?: string;
      analysis_tier?: string;
      full_status?: string;
      error?: string;
    };
    if (!res.ok) {
      return NextResponse.json(
        { error: payload.error || "Analyse konnte nicht gestartet werden" },
        { status: res.status === 429 ? 429 : 502 },
      );
    }
    return NextResponse.json({
      analysisTier: payload.analysis_tier ?? existing?.analysisTier ?? "basic",
      fullStatus: payload.full_status ?? "queued",
      status: payload.status ?? "started",
    });
  } catch (error) {
    console.error("[POST /api/zvg/ki/full]", error);
    return NextResponse.json({ error: "Analyse konnte nicht gestartet werden" }, { status: 500 });
  }
}
