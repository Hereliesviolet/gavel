import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { zvgListings } from "@/drizzle/schema";
import { and, count, desc, eq, gte, lt, or, sql } from "drizzle-orm";
import { isRateLimited, LIST_READ_RATE, recordRateLimitHit } from "@/lib/rate-limit";
import { LISTING_COVER_IMAGE_SQL } from "@/lib/listing-cover";
import { publicListingImageUrl } from "@/lib/safe-url";
import { isValidUuid, parseOptionalFinite } from "@/lib/utils";

const MAX_LIMIT = 300;
const MAX_OFFSET = 600;

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });
  }

  const rateKey = `objekte:${session.user.id}`;
  if (await isRateLimited(rateKey, LIST_READ_RATE)) {
    return NextResponse.json({ error: "Zu viele Listen-Anfragen." }, { status: 429 });
  }
  await recordRateLimitHit(rateKey, LIST_READ_RATE);

  try {
    const { searchParams } = request.nextUrl;
    const rawLimit = parseOptionalFinite(searchParams.get("limit"));
    const limit = rawLimit == null ? MAX_LIMIT : Math.min(Math.max(1, rawLimit), MAX_LIMIT);
    const rawOffset = parseOptionalFinite(searchParams.get("offset"));
    const offset = rawOffset == null ? 0 : Math.min(Math.max(0, rawOffset), MAX_OFFSET);
    const rawSinceHours = parseOptionalFinite(searchParams.get("sinceHours"));
    const sinceHours = rawSinceHours == null ? null : Math.min(Math.max(1, rawSinceHours), 336);
    const since = sinceHours == null ? null : new Date(Date.now() - sinceHours * 60 * 60 * 1000);
    const afterCreatedAtRaw = searchParams.get("afterCreatedAt");
    const afterCreatedAt = afterCreatedAtRaw ? new Date(afterCreatedAtRaw) : null;
    const afterIdRaw = searchParams.get("afterId");
    const afterId = afterIdRaw && isValidUuid(afterIdRaw) ? afterIdRaw : null;
    const afterOk =
      afterCreatedAt != null && !Number.isNaN(afterCreatedAt.getTime()) && afterId != null;
    const createdOrder = since != null || searchParams.get("order") === "created";
    const useCursor = createdOrder && afterOk;

    const windowWhere = since
      ? and(eq(zvgListings.istAktiv, true), gte(zvgListings.createdAt, since))
      : eq(zvgListings.istAktiv, true);
    const cursorWhere = useCursor
      ? or(
          lt(zvgListings.createdAt, afterCreatedAt),
          and(eq(zvgListings.createdAt, afterCreatedAt), lt(zvgListings.id, afterId)),
        )
      : undefined;
    const where = cursorWhere ? and(windowWhere, cursorWhere) : windowWhere;

    const [objekte, countRow] = await Promise.all([
      db
        .select({
          id: zvgListings.id,
          slug: zvgListings.slug,
          bundesland: zvgListings.bundesland,
          bundeslandName: zvgListings.bundeslandName,
          adresse: zvgListings.adresse,
          ort: zvgListings.ort,
          typ: zvgListings.typ,
          kategorie: zvgListings.kategorie,
          verkehrswert: zvgListings.verkehrswert,
          terminDate: zvgListings.terminDate,
          amtsgericht: zvgListings.amtsgericht,
          wohnflaecheM2: zvgListings.wohnflaecheM2,
          nutzflaecheM2: zvgListings.nutzflaecheM2,
          zimmer: zvgListings.zimmer,
          baujahr: zvgListings.baujahr,
          istNeu: zvgListings.istNeu,
          denkmalschutz: zvgListings.denkmalschutz,
          vermietet: zvgListings.vermietet,
          createdAt: zvgListings.createdAt,
          coverImageUrl: LISTING_COVER_IMAGE_SQL,
        })
        .from(zvgListings)
        .where(where)
        .orderBy(
          ...(createdOrder
            ? [desc(zvgListings.createdAt), desc(zvgListings.id)]
            : [
                sql`(
          EXISTS (SELECT 1 FROM zvg_images WHERE listing_id = "zvg_listings"."id")
        ) DESC`,
                desc(zvgListings.createdAt),
                desc(zvgListings.id),
              ]),
        )
        .limit(limit)
        .offset(useCursor ? 0 : offset),
      createdOrder
        ? db
            .select({ total: count() })
            .from(zvgListings)
            .where(windowWhere)
            .then((rows) => rows[0])
        : Promise.resolve({ total: null }),
    ]);

    return NextResponse.json({
      listings: objekte.map((row) => ({
        ...row,
        createdAt: row.createdAt ? row.createdAt.toISOString() : null,
        coverImageUrl: publicListingImageUrl(row.coverImageUrl),
      })),
      total: createdOrder ? Number(countRow?.total ?? 0) : null,
    });
  } catch {
    return NextResponse.json({ error: "DB-Fehler" }, { status: 500 });
  }
}
