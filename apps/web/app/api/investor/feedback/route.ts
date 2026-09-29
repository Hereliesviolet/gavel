import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { investorAnalysisFeedback, zvgListings } from "@/drizzle/schema";
import { isValidUuid } from "@/lib/utils";
import { isInvestorDomain } from "@/lib/product-domains";
import { isRateLimited, LIST_READ_RATE, recordRateLimitHit } from "@/lib/rate-limit";
import { rejectUntrustedMutation } from "@/lib/request-meta";
import { readJsonCapped, rejectCappedJson } from "@/lib/request-body";

const INVESTOR_WRITE_RATE = { max: 20, windowSeconds: 10 * 60, failClosed: true };

const feedbackSchema = z.object({
  listingId: z.string().uuid(),
  verdict: z.enum(["useful", "not_useful", "unclear"]),
  strategy: z.enum(["buy_hold", "fix_flip", "unter_markt", "zeitnah"]).nullable().optional(),
  comment: z.string().trim().max(1_000).nullable().optional(),
  analysisVersion: z.string().trim().min(1).max(200),
});

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });
  }

  const rateKey = `investor-feedback-read:${session.user.id}`;
  if (await isRateLimited(rateKey, LIST_READ_RATE)) {
    return NextResponse.json({ error: "Zu viele Feedback-Anfragen." }, { status: 429 });
  }
  await recordRateLimitHit(rateKey, LIST_READ_RATE);

  const listingId = request.nextUrl.searchParams.get("listingId");
  if (listingId && !isValidUuid(listingId)) {
    return NextResponse.json({ error: "Ungültige Listing-ID" }, { status: 400 });
  }

  const feedback = await db
    .select()
    .from(investorAnalysisFeedback)
    .where(
      and(
        eq(investorAnalysisFeedback.userId, session.user.id),
        sql`EXISTS (SELECT 1 FROM zvg_listings z WHERE z.id = ${investorAnalysisFeedback.listingId})`,
        listingId ? eq(investorAnalysisFeedback.listingId, listingId) : undefined,
      ),
    )
    .orderBy(desc(investorAnalysisFeedback.updatedAt), desc(investorAnalysisFeedback.id))
    .limit(100);
  return NextResponse.json({ feedback });
}

export async function POST(request: NextRequest) {
  const csrf = rejectUntrustedMutation(request);
  if (csrf) return csrf;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });
  }

  const rateKey = `investor-feedback:${session.user.id}`;
  if (await isRateLimited(rateKey, INVESTOR_WRITE_RATE)) {
    return NextResponse.json(
      { error: "Zu viele Änderungen. Bitte später erneut versuchen." },
      { status: 429 },
    );
  }
  await recordRateLimitHit(rateKey, INVESTOR_WRITE_RATE);

  const json = await readJsonCapped(request);
  if (!json.ok) return rejectCappedJson(json, "Ungültige JSON-Anfrage");
  const body = json.value;
  const parsed = feedbackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültiges Feedback" }, { status: 400 });
  }

  if (!isInvestorDomain("zvg")) {
    return NextResponse.json({ error: "Objekt nicht gefunden" }, { status: 404 });
  }
  const listing = await db.query.zvgListings.findFirst({
    where: eq(zvgListings.id, parsed.data.listingId),
    columns: { id: true },
  });
  if (!listing) {
    return NextResponse.json({ error: "Objekt nicht gefunden" }, { status: 404 });
  }

  try {
    const values = {
      userId: session.user.id,
      listingId: parsed.data.listingId,
      verdict: parsed.data.verdict,
      strategy: parsed.data.strategy ?? null,
      comment: parsed.data.comment ?? null,
      analysisVersion: parsed.data.analysisVersion,
      updatedAt: new Date(),
    };
    const [feedback] = await db
      .insert(investorAnalysisFeedback)
      .values(values)
      .onConflictDoUpdate({
        target: [
          investorAnalysisFeedback.userId,
          investorAnalysisFeedback.listingId,
          investorAnalysisFeedback.analysisVersion,
        ],
        set: values,
      })
      .returning();
    return NextResponse.json({ feedback }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/investor/feedback]", error);
    return NextResponse.json(
      { error: "Feedback konnte nicht gespeichert werden." },
      { status: 503 },
    );
  }
}
