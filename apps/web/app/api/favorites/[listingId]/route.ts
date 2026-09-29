import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userFavorites } from "@/drizzle/schema";
import { and, eq } from "drizzle-orm";
import { tryAddFavorite } from "@/lib/favorite-write";
import { isFavoritableDomain, MAX_FAVORITES_PER_USER } from "@/lib/product-domains";
import { isValidUuid } from "@/lib/utils";
import { isRateLimited, recordRateLimitHit } from "@/lib/rate-limit";
import { rejectUntrustedMutation } from "@/lib/request-meta";
import { readJsonCapped, rejectCappedJson } from "@/lib/request-body";

const FAVORITE_WRITE_RATE = { max: 40, windowSeconds: 10 * 60, failClosed: true };

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ listingId: string }> },
) {
  const csrf = rejectUntrustedMutation(req);
  if (csrf) return csrf;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });
  }

  const rateKey = `favorites:${session.user.id}`;
  if (await isRateLimited(rateKey, FAVORITE_WRITE_RATE)) {
    return NextResponse.json(
      { error: "Zu viele Favoriten-Änderungen. Bitte später erneut versuchen." },
      { status: 429 },
    );
  }
  await recordRateLimitHit(rateKey, FAVORITE_WRITE_RATE);

  const { listingId } = await params;
  if (!isValidUuid(listingId)) {
    return NextResponse.json({ error: "Ungültige Listing-ID" }, { status: 400 });
  }
  let listingType = "zvg";
  const json = await readJsonCapped(req);
  if (!json.ok) return rejectCappedJson(json);
  if (
    json.value &&
    typeof json.value === "object" &&
    !Array.isArray(json.value) &&
    typeof (json.value as { listingType?: unknown }).listingType === "string"
  ) {
    listingType = (json.value as { listingType: string }).listingType;
  }

  const added = await tryAddFavorite(session.user.id, listingId, listingType);
  if (added === "invalid") {
    return NextResponse.json({ error: "Ungültiger Listing-Typ" }, { status: 400 });
  }
  if (added === "not_found") {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }
  if (added === "full") {
    return NextResponse.json(
      { error: `Maximal ${MAX_FAVORITES_PER_USER} Favoriten pro Konto.` },
      { status: 400 },
    );
  }
  return NextResponse.json({ favorited: true });
}

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

  const rateKey = `favorites:${session.user.id}`;
  if (await isRateLimited(rateKey, FAVORITE_WRITE_RATE)) {
    return NextResponse.json(
      { error: "Zu viele Favoriten-Änderungen. Bitte später erneut versuchen." },
      { status: 429 },
    );
  }
  await recordRateLimitHit(rateKey, FAVORITE_WRITE_RATE);

  const { listingId } = await params;
  if (!isValidUuid(listingId)) {
    return NextResponse.json({ error: "Ungültige Listing-ID" }, { status: 400 });
  }

  let listingType = "zvg";
  const json = await readJsonCapped(req);
  if (!json.ok) {
    if (json.status === 413) return rejectCappedJson(json);
  } else if (
    json.value &&
    typeof json.value === "object" &&
    !Array.isArray(json.value) &&
    typeof (json.value as { listingType?: unknown }).listingType === "string"
  ) {
    listingType = (json.value as { listingType: string }).listingType;
  }
  if (!isFavoritableDomain(listingType)) {
    return NextResponse.json({ error: "Ungültiger Listing-Typ" }, { status: 400 });
  }

  try {
    await db
      .delete(userFavorites)
      .where(
        and(
          eq(userFavorites.userId, session.user.id),
          eq(userFavorites.listingId, listingId),
          eq(userFavorites.listingType, listingType),
        ),
      );

    return NextResponse.json({ favorited: false });
  } catch (error) {
    console.error("[favorites DELETE]", error);
    return NextResponse.json({ error: "Fehler" }, { status: 500 });
  }
}
