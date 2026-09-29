import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { realEstateKiAnalyses } from "@/drizzle/schema";
import { desc, eq } from "drizzle-orm";
import {
  findAccessibleRealEstateListing,
  removeUserCustomListingAccess,
} from "@/lib/analyse-access";
import { minioClient, MINIO_BUCKET } from "@/lib/minio";
import {
  omitKiInternals,
  omitListingInternals,
  omitPurchaseUnderwriting,
} from "@/lib/listing-public";
import { isListingOwnedStoragePath } from "@/lib/object-stream";
import { isValidUuid } from "@/lib/utils";
import { isRateLimited, recordRateLimitHit } from "@/lib/rate-limit";
import { rejectUntrustedMutation } from "@/lib/request-meta";

const ANALYSE_READ_RATE = { max: 60, windowSeconds: 60, failClosed: true };
const ANALYSE_DELETE_RATE = { max: 10, windowSeconds: 10 * 60, failClosed: true };

/**
 * Liefert ein einzelnes Custom-URL-Analyse-Ergebnis (Listing + neueste
 * Markt-Analyse), ohne rawData/Modell-Interna. Cookie-/HTML-/PDF-Listings
 * nur für den Einreicher; öffentliche Live-Scrapes zusätzlich über
 * erfolgreichen custom_url_requests-Eintrag.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ listingId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });
  }

  const rateKey = `analyse-read:${session.user.id}`;
  if (await isRateLimited(rateKey, ANALYSE_READ_RATE)) {
    return NextResponse.json({ error: "Zu viele Analyse-Anfragen." }, { status: 429 });
  }
  await recordRateLimitHit(rateKey, ANALYSE_READ_RATE);

  const { listingId } = await params;
  if (!isValidUuid(listingId)) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const listing = await findAccessibleRealEstateListing(session.user.id, listingId);
  if (!listing) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const analyse = await db.query.realEstateKiAnalyses.findFirst({
    where: eq(realEstateKiAnalyses.listingId, listingId),
    orderBy: [desc(realEstateKiAnalyses.analyzedAt)],
  });

  return NextResponse.json({
    listing: omitListingInternals(listing),
    analyse: analyse
      ? omitPurchaseUnderwriting(omitKiInternals(analyse), listing.angebotstyp)
      : null,
  });
}

/**
 * Entfernt die Analyse aus dem Verlauf. Geteilte öffentliche Live-Scrapes
 * bleiben erhalten, solange andere Nutzer sie noch nutzen; nur der letzte
 * bzw. der Einreicher privater Cookie-/HTML-/PDF-Zeilen löscht die Zeile.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ listingId: string }> },
) {
  const csrf = rejectUntrustedMutation(req);
  if (csrf) return csrf;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });
  }

  const rateKey = `analyse-delete:${session.user.id}`;
  if (await isRateLimited(rateKey, ANALYSE_DELETE_RATE)) {
    return NextResponse.json(
      { error: "Zu viele Löschvorgänge. Bitte später erneut versuchen." },
      { status: 429 },
    );
  }
  await recordRateLimitHit(rateKey, ANALYSE_DELETE_RATE);

  const { listingId } = await params;
  if (!isValidUuid(listingId)) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const result = await removeUserCustomListingAccess(session.user.id, listingId);
  if (!result) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }
  if (result.outcome === "busy") {
    return NextResponse.json(
      { error: "Analyse läuft noch. Bitte warten, bis sie fertig ist." },
      { status: 409 },
    );
  }

  const storagePaths =
    result.outcome === "deleted"
      ? result.storagePaths.filter((path) => isListingOwnedStoragePath(listingId, path))
      : [];
  if (result.outcome === "deleted" && storagePaths.length > 0) {
    try {
      await minioClient.removeObjects(MINIO_BUCKET, storagePaths);
    } catch (error) {
      console.error(`[DELETE /api/analyse/${listingId}] MinIO-Cleanup fehlgeschlagen`, error);
    }
  }

  return new NextResponse(null, { status: 204 });
}
