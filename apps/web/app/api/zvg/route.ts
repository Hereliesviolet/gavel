import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { zvgListings } from "@/drizzle/schema";
import { eq, and, gte, lte, count, asc, desc, SQL } from "drizzle-orm";
import { bundeslandColumnMatches } from "@/lib/bundesland";
import { parseListingKategorien } from "@/lib/kategorien";
import { listingTypeColumnMatches } from "@/lib/listing-type-filter";
import { omitListingInternals } from "@/lib/listing-public";
import { isRateLimited, LIST_READ_RATE, recordRateLimitHit } from "@/lib/rate-limit";
import { parseOptionalFinite } from "@/lib/utils";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });
  }

  const rateKey = `zvg-list:${session.user.id}`;
  if (await isRateLimited(rateKey, LIST_READ_RATE)) {
    return NextResponse.json({ error: "Zu viele Listen-Anfragen." }, { status: 429 });
  }
  await recordRateLimitHit(rateKey, LIST_READ_RATE);

  try {
    const sp = req.nextUrl.searchParams;

    const bundesland = sp.get("bundesland");
    const kategorie = sp.getAll("kategorie");
    const minPreis = parseOptionalFinite(sp.get("min_preis"), (value) =>
      Number.parseInt(value, 10),
    );
    const maxPreis = parseOptionalFinite(sp.get("max_preis"), (value) =>
      Number.parseInt(value, 10),
    );
    const minFlaeche = parseOptionalFinite(sp.get("min_flaeche"), Number.parseFloat);
    const maxFlaeche = parseOptionalFinite(sp.get("max_flaeche"), Number.parseFloat);
    const sort = sp.get("sort") ?? "neu_zuerst";
    const page = Math.min(Math.max(parseInt(sp.get("page") ?? "1") || 1, 1), 200);
    const perPage = Math.min(Math.max(parseInt(sp.get("per_page") ?? "20") || 20, 1), 100);
    const nurNeue = sp.get("nur_neue") === "1";

    const conditions: SQL[] = [eq(zvgListings.istAktiv, true)];

    // Bug-Fix (2026-07-04): normalisierter Vergleich statt eq(), siehe
    // lib/bundesland.ts - sonst bleiben Rohdaten-Schreibvarianten unsichtbar.
    if (bundesland) conditions.push(bundeslandColumnMatches(zvgListings.bundesland, bundesland));
    const kats = parseListingKategorien(kategorie);
    if (kats.length) {
      const typeMatch = listingTypeColumnMatches(kats);
      if (typeMatch) conditions.push(typeMatch);
    }
    if (minPreis !== null) conditions.push(gte(zvgListings.verkehrswert, String(minPreis)));
    if (maxPreis !== null) conditions.push(lte(zvgListings.verkehrswert, String(maxPreis)));
    if (minFlaeche !== null) conditions.push(gte(zvgListings.wohnflaecheM2, String(minFlaeche)));
    if (maxFlaeche !== null) conditions.push(lte(zvgListings.wohnflaecheM2, String(maxFlaeche)));
    if (nurNeue) conditions.push(eq(zvgListings.istNeu, true));

    const orderMap: Record<string, SQL[]> = {
      neu_zuerst: [desc(zvgListings.createdAt), desc(zvgListings.id)],
      termin_asc: [asc(zvgListings.terminDate), asc(zvgListings.id)],
      termin_desc: [desc(zvgListings.terminDate), desc(zvgListings.id)],
      preis_asc: [asc(zvgListings.verkehrswert), asc(zvgListings.id)],
      preis_desc: [desc(zvgListings.verkehrswert), desc(zvgListings.id)],
    };
    const orderBy = orderMap[sort] ?? [desc(zvgListings.createdAt), desc(zvgListings.id)];

    const COUNT_CAP = 5_000;
    const capped = db
      .select({ id: zvgListings.id })
      .from(zvgListings)
      .where(and(...conditions))
      .limit(COUNT_CAP + 1)
      .as("zvg_count_cap");
    const [{ total }] = await db.select({ total: count() }).from(capped);

    const listings = await db
      .select()
      .from(zvgListings)
      .where(and(...conditions))
      .orderBy(...orderBy)
      .limit(perPage)
      .offset((page - 1) * perPage);

    return NextResponse.json({
      listings: listings.map(omitListingInternals),
      total: Math.min(total, COUNT_CAP),
      page,
      per_page: perPage,
      pages: Math.ceil(Math.min(total, COUNT_CAP) / perPage),
    });
  } catch (error) {
    console.error("[/api/zvg]", error);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
