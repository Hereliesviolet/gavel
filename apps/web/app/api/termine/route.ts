import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { zvgListings } from "@/drizzle/schema";
import { eq, and, asc, isNotNull, count } from "drizzle-orm";
import { isRateLimited, LIST_READ_RATE, recordRateLimitHit } from "@/lib/rate-limit";
import { LISTING_COVER_IMAGE_SQL } from "@/lib/listing-cover";
import { publicListingImageUrl } from "@/lib/safe-url";
import { upcomingTerminSql } from "@/lib/termin-sql";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });
  }

  const rateKey = `termine:${session.user.id}`;
  if (await isRateLimited(rateKey, LIST_READ_RATE)) {
    return NextResponse.json({ error: "Zu viele Listen-Anfragen." }, { status: 429 });
  }
  await recordRateLimitHit(rateKey, LIST_READ_RATE);

  try {
    const where = and(
      eq(zvgListings.istAktiv, true),
      upcomingTerminSql(),
      isNotNull(zvgListings.terminDate),
    );
    const [rows, [{ total }]] = await Promise.all([
      db
        .select({
          id: zvgListings.id,
          slug: zvgListings.slug,
          bundesland: zvgListings.bundesland,
          bundeslandName: zvgListings.bundeslandName,
          adresse: zvgListings.adresse,
          ort: zvgListings.ort,
          typ: zvgListings.typ,
          verkehrswert: zvgListings.verkehrswert,
          terminDate: zvgListings.terminDate,
          amtsgericht: zvgListings.amtsgericht,
          coverImageUrl: LISTING_COVER_IMAGE_SQL,
        })
        .from(zvgListings)
        .where(where)
        .orderBy(asc(zvgListings.terminDate), asc(zvgListings.id))
        .limit(500),
      db.select({ total: count() }).from(zvgListings).where(where),
    ]);

    return NextResponse.json({
      termine: rows.map((row) => ({
        ...row,
        coverImageUrl: publicListingImageUrl(row.coverImageUrl),
      })),
      total: Number(total ?? 0),
    });
  } catch (error) {
    console.error("Termine API Fehler:", error);
    return NextResponse.json({ error: "DB-Fehler" }, { status: 500 });
  }
}
