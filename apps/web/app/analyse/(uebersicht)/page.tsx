import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { realEstateListings, realEstateKiAnalyses, customUrlRequests } from "@/drizzle/schema";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { canReadCustomListing } from "@/lib/listing-privacy";
import { stripSensitiveUrlQuery } from "@/lib/safe-url";
import { AnalyseClient, type AnalyseHistoryEntry } from "./client";

export const metadata: Metadata = { title: "Custom-URL-Analyse – Gavel" };

const HISTORY_VISIBLE = 200;
const HISTORY_FETCH = 400;

export default async function AnalysePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=/analyse");

  const userId = session.user.id;

  const history: AnalyseHistoryEntry[] = [];
  {
    // Verlauf über custom_url_requests (nicht nur submitted_by_user_id), damit
    // erfolgreiche Analysen mit listing_id angezeigt werden – auch wenn das
    // Listing ursprünglich von einem anderen User/Smoke-Test angelegt wurde.
    // Zuerst eine Zeile pro Listing (neueste Anfrage), dann Limit — sonst
    // verdrängen Re-Runs und nicht lesbare Zeilen ältere Einträge.
    const latest = await db
      .select({
        listingId: customUrlRequests.listingId,
        requestedAt: sql<Date>`max(${customUrlRequests.requestedAt})`.as("requested_at"),
      })
      .from(customUrlRequests)
      .where(
        and(
          eq(customUrlRequests.userId, userId),
          eq(customUrlRequests.status, "success"),
          isNotNull(customUrlRequests.listingId),
        ),
      )
      .groupBy(customUrlRequests.listingId)
      .orderBy(sql`max(${customUrlRequests.requestedAt}) desc`)
      .limit(HISTORY_FETCH);

    const listingIds = latest.map((row) => row.listingId).filter((id): id is string => Boolean(id));

    const listingRows = listingIds.length
      ? await db
          .select({
            listingId: realEstateListings.id,
            titel: realEstateListings.titel,
            sourceUrl: realEstateListings.sourceUrl,
            source: realEstateListings.source,
            preis: realEstateListings.preis,
            angebotstyp: realEstateListings.angebotstyp,
            wohnflaecheM2: realEstateListings.wohnflaecheM2,
            ort: realEstateListings.ort,
            preisBewertung: realEstateKiAnalyses.preisBewertung,
            zusammenfassung: realEstateKiAnalyses.zusammenfassung,
            analyzedAt: realEstateKiAnalyses.analyzedAt,
            submittedByUserId: realEstateListings.submittedByUserId,
            rawData: realEstateListings.rawData,
            istAktiv: realEstateListings.istAktiv,
          })
          .from(realEstateListings)
          .leftJoin(
            realEstateKiAnalyses,
            and(
              eq(realEstateKiAnalyses.listingId, realEstateListings.id),
              eq(
                realEstateKiAnalyses.analyzedAt,
                sql`(
                  SELECT MAX(analyzed_at)
                  FROM real_estate_ki_analyses
                  WHERE listing_id = ${realEstateListings.id}
                )`,
              ),
            ),
          )
          .where(inArray(realEstateListings.id, listingIds))
      : [];

    const byId = new Map(listingRows.map((row) => [row.listingId, row]));
    for (const row of latest) {
      if (history.length >= HISTORY_VISIBLE) break;
      const r = row.listingId ? byId.get(row.listingId) : undefined;
      if (!r || !canReadCustomListing(r, userId)) continue;
      history.push({
        listingId: r.listingId,
        titel: r.titel,
        sourceUrl: r.sourceUrl ? stripSensitiveUrlQuery(r.sourceUrl) : r.sourceUrl,
        source: r.source,
        preis: r.preis,
        angebotstyp: r.angebotstyp,
        wohnflaecheM2: r.wohnflaecheM2 ? Number(r.wohnflaecheM2) : null,
        ort: r.ort,
        preisBewertung: r.preisBewertung,
        zusammenfassung: r.zusammenfassung,
        analyzedAt: r.analyzedAt ?? row.requestedAt,
        offline: r.istAktiv === false,
      });
    }
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(customUrlRequests)
    .where(and(eq(customUrlRequests.userId, userId), eq(customUrlRequests.status, "error")));
  const failedAttempts = count ?? 0;

  return <AnalyseClient initialHistory={history} failedAttempts={Math.max(0, failedAttempts)} />;
}
