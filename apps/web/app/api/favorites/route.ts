import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userFavorites } from "@/drizzle/schema";
import { and, eq } from "drizzle-orm";
import { filterAccessibleFavorites } from "@/lib/analyse-access";
import { listExistingUserFavorites, tryAddFavorite } from "@/lib/favorite-write";
import { isFavoritableDomain, MAX_FAVORITES_PER_USER } from "@/lib/product-domains";
import { isValidUuid } from "@/lib/utils";
import { isRateLimited, LIST_READ_RATE, recordRateLimitHit } from "@/lib/rate-limit";
import { rejectUntrustedMutation } from "@/lib/request-meta";
import { readJsonCapped, rejectCappedJson } from "@/lib/request-body";

const FAVORITE_WRITE_RATE = { max: 40, windowSeconds: 10 * 60, failClosed: true };

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });
  }

  const rateKey = `favorites-read:${session.user.id}`;
  if (await isRateLimited(rateKey, LIST_READ_RATE)) {
    return NextResponse.json({ error: "Zu viele Favoriten-Anfragen." }, { status: 429 });
  }
  await recordRateLimitHit(rateKey, LIST_READ_RATE);

  try {
    const favorites = await listExistingUserFavorites(session.user.id);
    return NextResponse.json({
      favorites: await filterAccessibleFavorites(session.user.id, favorites),
    });
  } catch (error) {
    console.error("[GET /api/favorites]", error);
    return NextResponse.json({ error: "Datenbankfehler" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
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

  const json = await readJsonCapped(req);
  if (!json.ok) return rejectCappedJson(json);
  const payload =
    json.value && typeof json.value === "object" && !Array.isArray(json.value)
      ? (json.value as Record<string, unknown>)
      : {};

  try {
    const listingId = payload.listingId;
    const listingType = typeof payload.listingType === "string" ? payload.listingType : "zvg";

    if (typeof listingId !== "string" || !isValidUuid(listingId)) {
      return NextResponse.json({ error: "Ungültige Listing-ID" }, { status: 400 });
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
    return NextResponse.json({ favorited: true }, { status: added === "created" ? 201 : 200 });
  } catch (error) {
    console.error("[POST /api/favorites]", error);
    return NextResponse.json({ error: "Fehler" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
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

  try {
    const listingId = req.nextUrl.searchParams.get("listingId");
    const listingType = req.nextUrl.searchParams.get("listingType") ?? "zvg";

    if (!listingId || !isValidUuid(listingId)) {
      return NextResponse.json({ error: "Ungültige Listing-ID" }, { status: 400 });
    }
    if (!isFavoritableDomain(listingType)) {
      return NextResponse.json({ error: "Ungültiger Listing-Typ" }, { status: 400 });
    }

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
    console.error("[DELETE /api/favorites]", error);
    return NextResponse.json({ error: "Fehler" }, { status: 500 });
  }
}
