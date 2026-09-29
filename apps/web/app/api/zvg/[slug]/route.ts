import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { zvgKiAnalyses, zvgImages } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { LISTING_COVER_ORDER } from "@/lib/listing-cover";
import { omitKiInternals, omitListingInternals, omitZvgImageInternals } from "@/lib/listing-public";
import { isUsableZvgSlug, zvgBundeslandFromRequest } from "@/lib/zvg-documents";
import { findZvgListingBySlug } from "@/lib/zvg-listing-lookup";
import { isRateLimited, LIST_READ_RATE, recordRateLimitHit } from "@/lib/rate-limit";

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });
  }

  const rateKey = `zvg-detail:${session.user.id}`;
  if (await isRateLimited(rateKey, LIST_READ_RATE)) {
    return NextResponse.json({ error: "Zu viele Listen-Anfragen." }, { status: 429 });
  }
  await recordRateLimitHit(rateKey, LIST_READ_RATE);

  try {
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

    const [ki, images] = await Promise.all([
      db.query.zvgKiAnalyses.findFirst({
        where: eq(zvgKiAnalyses.listingId, listing.id),
      }),
      db.query.zvgImages.findMany({
        where: eq(zvgImages.listingId, listing.id),
        orderBy: LISTING_COVER_ORDER,
      }),
    ]);

    return NextResponse.json({
      listing: omitListingInternals(listing),
      ki_analyse: ki ? omitKiInternals(ki) : null,
      images: images.map(omitZvgImageInternals),
    });
  } catch (error) {
    console.error("[/api/zvg/[slug]]", error);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
