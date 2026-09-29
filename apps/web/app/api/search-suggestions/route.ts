import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { zvgListings } from "@/drizzle/schema";
import { and, eq, ilike, or } from "drizzle-orm";
import { clipSearchQuery, containsIlikePattern, prefixIlikePattern } from "@/lib/sql-like";
import { isRateLimited, recordRateLimitHit } from "@/lib/rate-limit";
import { upcomingTerminSql } from "@/lib/termin-sql";

const SUGGEST_RATE = { max: 30, windowSeconds: 60, failClosed: true };

export interface SearchSuggestionListing {
  slug: string;
  bundesland: string;
  titel: string;
  ort: string | null;
}

export interface SearchSuggestions {
  orte: string[];
  amtsgerichte: string[];
  plz: string[];
  listings: SearchSuggestionListing[];
}

const EMPTY_SUGGESTIONS: SearchSuggestions = {
  orte: [],
  amtsgerichte: [],
  plz: [],
  listings: [],
};

const SUGGESTIONS_PER_GROUP = 5;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });
  }

  const rateKey = `suggest:${session.user.id}`;
  if (await isRateLimited(rateKey, SUGGEST_RATE)) {
    return NextResponse.json({ error: "Zu viele Suchvorschläge." }, { status: 429 });
  }
  await recordRateLimitHit(rateKey, SUGGEST_RATE);

  const q = clipSearchQuery(req.nextUrl.searchParams.get("q") ?? "");

  if (q.length < 2) {
    return NextResponse.json(EMPTY_SUGGESTIONS);
  }

  const containsTerm = containsIlikePattern(q);
  const startsWithTerm = prefixIlikePattern(q);
  const visible = and(eq(zvgListings.istAktiv, true), upcomingTerminSql());

  try {
    const [orteRows, amtsgerichteRows, plzRows, listingRows] = await Promise.all([
      db
        .selectDistinct({ ort: zvgListings.ort })
        .from(zvgListings)
        .where(and(visible, ilike(zvgListings.ort, containsTerm)))
        .limit(SUGGESTIONS_PER_GROUP),
      db
        .selectDistinct({ amtsgericht: zvgListings.amtsgericht })
        .from(zvgListings)
        .where(and(visible, ilike(zvgListings.amtsgericht, containsTerm)))
        .limit(SUGGESTIONS_PER_GROUP),
      db
        .selectDistinct({ plz: zvgListings.plz })
        .from(zvgListings)
        .where(and(visible, ilike(zvgListings.plz, startsWithTerm)))
        .limit(SUGGESTIONS_PER_GROUP),
      db
        .select({
          slug: zvgListings.slug,
          bundesland: zvgListings.bundesland,
          typ: zvgListings.typ,
          adresse: zvgListings.adresse,
          ort: zvgListings.ort,
        })
        .from(zvgListings)
        .where(
          and(
            visible,
            or(ilike(zvgListings.adresse, containsTerm), ilike(zvgListings.ort, containsTerm))!,
          ),
        )
        .limit(SUGGESTIONS_PER_GROUP),
    ]);

    const suggestions: SearchSuggestions = {
      orte: orteRows.map((r) => r.ort).filter((v): v is string => Boolean(v)),
      amtsgerichte: amtsgerichteRows
        .map((r) => r.amtsgericht)
        .filter((v): v is string => Boolean(v)),
      plz: plzRows.map((r) => r.plz).filter((v): v is string => Boolean(v)),
      listings: listingRows.map((l) => ({
        slug: l.slug,
        bundesland: l.bundesland,
        ort: l.ort,
        titel: [l.typ, l.adresse ?? l.ort].filter(Boolean).join(" · ") || "Objekt",
      })),
    };

    return NextResponse.json(suggestions);
  } catch (error) {
    console.error("[/api/search-suggestions]", error);
    return NextResponse.json({ error: "Suchvorschläge nicht verfügbar" }, { status: 500 });
  }
}
