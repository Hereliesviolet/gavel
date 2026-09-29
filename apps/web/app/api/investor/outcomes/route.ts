import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { investorDealOutcomes, userFavorites, zvgListings } from "@/drizzle/schema";
import { isValidUuid } from "@/lib/utils";
import { DESK_STATUS } from "@/lib/deal-desk-status";
import { isInvestorDomain } from "@/lib/product-domains";
import { isRateLimited, LIST_READ_RATE, recordRateLimitHit } from "@/lib/rate-limit";
import { rejectUntrustedMutation } from "@/lib/request-meta";
import { readJsonCapped, rejectCappedJson } from "@/lib/request-body";

const INVESTOR_WRITE_RATE = { max: 20, windowSeconds: 10 * 60, failClosed: true };

const optionalMoney = z.coerce.number().int().min(0).max(1_000_000_000).nullable().optional();
const outcomeSchema = z.object({
  listingId: z.string().uuid(),
  status: z.enum(DESK_STATUS),
  strategy: z.enum(["buy_hold", "fix_flip", "unter_markt", "zeitnah"]).nullable().optional(),
  actualBidEur: optionalMoney,
  actualPurchasePriceEur: optionalMoney,
  actualRenovationEur: optionalMoney,
  actualHoldingMonths: z.coerce.number().int().min(0).max(1_200).nullable().optional(),
  actualMonthlyRentEur: optionalMoney,
  actualSalePriceEur: optionalMoney,
  notes: z.string().trim().max(2_000).nullable().optional(),
  occurredAt: z.coerce.date().nullable().optional(),
});

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });
  }
  const rateKey = `investor-outcomes-read:${session.user.id}`;
  if (await isRateLimited(rateKey, LIST_READ_RATE)) {
    return NextResponse.json({ error: "Zu viele Outcome-Anfragen." }, { status: 429 });
  }
  await recordRateLimitHit(rateKey, LIST_READ_RATE);

  const listingId = request.nextUrl.searchParams.get("listingId");
  if (listingId && !isValidUuid(listingId)) {
    return NextResponse.json({ error: "Ungültige Listing-ID" }, { status: 400 });
  }

  const outcomes = await db
    .select()
    .from(investorDealOutcomes)
    .where(
      and(
        eq(investorDealOutcomes.userId, session.user.id),
        sql`EXISTS (SELECT 1 FROM zvg_listings z WHERE z.id = ${investorDealOutcomes.listingId})`,
        listingId ? eq(investorDealOutcomes.listingId, listingId) : undefined,
      ),
    )
    .orderBy(desc(investorDealOutcomes.updatedAt), desc(investorDealOutcomes.id))
    .limit(100);

  return NextResponse.json({ outcomes });
}

export async function PUT(request: NextRequest) {
  const csrf = rejectUntrustedMutation(request);
  if (csrf) return csrf;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });
  }

  const rateKey = `investor-outcomes:${session.user.id}`;
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
  const parsed = outcomeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültiges Outcome" }, { status: 400 });
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
    const felder = {
      strategy: parsed.data.strategy,
      actualBidEur: parsed.data.actualBidEur,
      actualPurchasePriceEur: parsed.data.actualPurchasePriceEur,
      actualRenovationEur: parsed.data.actualRenovationEur,
      actualHoldingMonths: parsed.data.actualHoldingMonths,
      actualMonthlyRentEur: parsed.data.actualMonthlyRentEur,
      actualSalePriceEur: parsed.data.actualSalePriceEur,
      notes: parsed.data.notes,
      occurredAt: parsed.data.occurredAt,
    };
    // Nur mitgeschickte Felder überschreiben. Ein Statuswechsel im Desk sendet
    // nichts weiter mit und darf deshalb keine Notiz und kein erfasstes Gebot
    // löschen.
    const gesetzt = Object.fromEntries(
      Object.entries(felder).filter(([, wert]) => wert !== undefined),
    );

    const [outcome] = await db
      .insert(investorDealOutcomes)
      .values({
        userId: session.user.id,
        listingId: parsed.data.listingId,
        status: parsed.data.status,
        ...gesetzt,
      })
      .onConflictDoUpdate({
        target: [investorDealOutcomes.userId, investorDealOutcomes.listingId],
        set: { status: parsed.data.status, ...gesetzt, updatedAt: new Date() },
      })
      .returning();
    return NextResponse.json({ outcome });
  } catch (error) {
    console.error("[PUT /api/investor/outcomes]", error);
    return NextResponse.json(
      { error: "Outcome konnte nicht gespeichert werden." },
      { status: 503 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const csrf = rejectUntrustedMutation(request);
  if (csrf) return csrf;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });
  }
  const userId = session.user.id;

  const rateKey = `investor-outcomes:${userId}`;
  if (await isRateLimited(rateKey, INVESTOR_WRITE_RATE)) {
    return NextResponse.json(
      { error: "Zu viele Änderungen. Bitte später erneut versuchen." },
      { status: 429 },
    );
  }
  await recordRateLimitHit(rateKey, INVESTOR_WRITE_RATE);

  const listingId = request.nextUrl.searchParams.get("listingId");
  if (!listingId || !isValidUuid(listingId)) {
    return NextResponse.json({ error: "Ungültige Listing-ID" }, { status: 400 });
  }
  const alsoFavorite = request.nextUrl.searchParams.get("alsoFavorite") === "1";

  try {
    await db.transaction(async (tx) => {
      await tx
        .delete(investorDealOutcomes)
        .where(
          and(
            eq(investorDealOutcomes.userId, userId),
            eq(investorDealOutcomes.listingId, listingId),
          ),
        );
      if (alsoFavorite) {
        await tx
          .delete(userFavorites)
          .where(
            and(
              eq(userFavorites.userId, userId),
              eq(userFavorites.listingId, listingId),
              eq(userFavorites.listingType, "zvg"),
            ),
          );
      }
    });
  } catch (error) {
    console.error("[DELETE /api/investor/outcomes]", error);
    return NextResponse.json({ error: "Outcome konnte nicht gelöscht werden." }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
