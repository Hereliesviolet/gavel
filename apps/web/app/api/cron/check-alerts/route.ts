import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userAlerts, users, zvgListings, zvgImages, alertNotifications } from "@/drizzle/schema";
import { eq, and, desc, gte, lte, inArray, ilike, isNotNull, or, sql } from "drizzle-orm";
import { sendAlertEmail } from "@/lib/email";
import {
  alertExactPlz,
  alertRadiusBoundingBox,
  enrichAlertCriteria,
  listingMatchesAlertRadius,
  shouldSkipAlertForMissingGeocode,
} from "@/lib/alert-geocode";
import { bundeslandColumnMatches } from "@/lib/bundesland";
import { alertDueSql, alertIsDue } from "@/lib/alert-frequency";
import { rejectIfCronUnauthorized } from "@/lib/cron-auth";
import {
  ALERT_MATCH_MAX_PAGES,
  ALERT_MATCH_PAGE_SIZE,
  MAX_ALERTS_PER_CRON_RUN,
  MAX_EMAILS_PER_CRON_RUN,
  MAX_LISTINGS_PER_ALERT_EMAIL,
  parseAlertCriteria,
  takeUnnotifiedAlertMatches,
} from "@/lib/alert-input";
import { containsIlikePattern } from "@/lib/sql-like";
import { LISTING_COVER_ORDER } from "@/lib/listing-cover";
import { listingTypeColumnMatches } from "@/lib/listing-type-filter";
import { upcomingTerminSql } from "@/lib/termin-sql";
import { pruneExpiredOperationalRows } from "@/lib/retention";

interface AlertCriteria {
  bundesland?: string;
  kategorie?: string[];
  min_preis?: number;
  max_preis?: number;
  min_flaeche?: number;
  max_flaeche?: number;
  amtsgericht?: string;
  plz?: string;
  umkreis_km?: number;
  plz_lat?: number;
  plz_lng?: number;
  [key: string]: unknown;
}

const MAX_LISTINGS_PER_EMAIL = MAX_LISTINGS_PER_ALERT_EMAIL;
const MAX_ALERT_GEOCODE_HEALS_PER_RUN = 5;

async function markAlertChecked(alertId: string, at: Date) {
  await db.update(userAlerts).set({ lastTriggeredAt: at }).where(eq(userAlerts.id, alertId));
}

/**
 * Alert-Matching & Versand.
 *
 * Aufgerufen (a) vom Prefect-Flow `scrapers/src/flows/check_alerts.py` nach
 * jedem täglichen Scraper-Lauf sowie (b) stündlich per Cron (analog zu
 * archive_expired.sh) - siehe DEPLOYMENT.md. Diese Route lebt bewusst in
 * Next.js statt in Python/smtplib: Matching-Logik, E-Mail-Template und
 * Dedup-Tabelle sind bereits hier vorhanden/typisiert, ein zweites,
 * unabhängiges Python-Äquivalent (inkl. eigener SMTP-Konfiguration im
 * Scraper-Container) hätte Logik & Konfiguration unnötig dupliziert.
 *
 * Dedup: `alertNotifications` protokolliert jede bereits verschickte
 * (alertId, listingId)-Kombination (UNIQUE-Constraint) - robuster als ein
 * reiner Zeit-Cursor, da auch nachträglich bearbeitete/reaktivierte Alerts
 * keine Duplikate/Lücken erzeugen. Die Zeile entsteht erst nach erfolgreichem
 * SMTP; ein Abbruch dazwischen lässt den Treffer erneut zu.
 */
async function runCheckAlerts(req: NextRequest) {
  const cronDenied = rejectIfCronUnauthorized(req, "email");
  if (cronDenied) return cronDenied;

  const now = new Date();
  let processed = 0;
  let emails = 0;
  let newMatches = 0;
  let skippedMissingGeocode = 0;
  let geocodeHeals = 0;
  const errors: string[] = [];

  try {
    const activeAlerts = await db
      .select()
      .from(userAlerts)
      .where(and(eq(userAlerts.isActive, true), eq(userAlerts.alertType, "zvg"), alertDueSql(now)))
      .orderBy(sql`${userAlerts.lastTriggeredAt} ASC NULLS FIRST, ${userAlerts.id} ASC`)
      .limit(MAX_ALERTS_PER_CRON_RUN);

    // Vorher wurde pro Alert ein
    // eigener User-Lookup ausgeführt (N+1 - bei z.B. 500 aktiven Alerts 500
    // sequenzielle Round-Trips). Stattdessen alle benötigten User in einem
    // Batch per inArray() vorladen und darüber per Map nachschlagen.
    const userIds = [
      ...new Set(activeAlerts.map((a) => a.userId).filter((id): id is string => Boolean(id))),
    ];
    const alertUsers = userIds.length
      ? await db.query.users.findMany({ where: inArray(users.id, userIds) })
      : [];
    const usersById = new Map(alertUsers.map((u) => [u.id, u]));

    for (const alert of activeAlerts) {
      if (emails >= MAX_EMAILS_PER_CRON_RUN) break;
      try {
        const user = alert.userId ? usersById.get(alert.userId) : undefined;

        if (!user?.email) {
          await markAlertChecked(alert.id, now);
          continue;
        }
        if (!alertIsDue(alert.frequency, alert.lastTriggeredAt, now)) continue;
        if (!parseAlertCriteria(alert.criteria ?? {})) {
          await markAlertChecked(alert.id, now);
          continue;
        }

        let criteria = (alert.criteria ?? {}) as AlertCriteria;
        if (shouldSkipAlertForMissingGeocode(criteria)) {
          if (geocodeHeals >= MAX_ALERT_GEOCODE_HEALS_PER_RUN) {
            skippedMissingGeocode += 1;
            errors.push(`Alert ${alert.id}: Umkreis ohne Koordinaten`);
            await markAlertChecked(alert.id, now);
            continue;
          }
          geocodeHeals += 1;
          const healed = await enrichAlertCriteria(criteria);
          if (healed.ok && !shouldSkipAlertForMissingGeocode(healed.criteria)) {
            criteria = healed.criteria;
            await db.update(userAlerts).set({ criteria }).where(eq(userAlerts.id, alert.id));
          } else {
            skippedMissingGeocode += 1;
            errors.push(`Alert ${alert.id}: Umkreis ohne Koordinaten`);
            await markAlertChecked(alert.id, now);
            continue;
          }
        }

        const conditions = [
          eq(zvgListings.istAktiv, true),
          eq(zvgListings.needsReview, false),
          upcomingTerminSql(),
        ];

        if (criteria.bundesland) {
          // Bug-Fix (2026-07-04): normalisierter Vergleich statt eq(), siehe
          // lib/bundesland.ts - sonst verpassen Alerts Objekte mit
          // abweichender Bundesland-Rohschreibweise.
          conditions.push(bundeslandColumnMatches(zvgListings.bundesland, criteria.bundesland));
        }
        if (criteria.kategorie?.length) {
          const typeMatch = listingTypeColumnMatches(criteria.kategorie);
          if (typeMatch) conditions.push(typeMatch);
        }
        if (criteria.min_preis != null) {
          conditions.push(gte(zvgListings.verkehrswert, String(criteria.min_preis)));
        }
        if (criteria.max_preis != null) {
          conditions.push(lte(zvgListings.verkehrswert, String(criteria.max_preis)));
        }
        if (criteria.min_flaeche != null) {
          conditions.push(gte(zvgListings.wohnflaecheM2, String(criteria.min_flaeche)));
        }
        if (criteria.max_flaeche != null) {
          conditions.push(lte(zvgListings.wohnflaecheM2, String(criteria.max_flaeche)));
        }
        if (criteria.amtsgericht) {
          conditions.push(
            ilike(zvgListings.amtsgericht, containsIlikePattern(String(criteria.amtsgericht))),
          );
        }
        const exactPlz = alertExactPlz(criteria);
        if (exactPlz) {
          conditions.push(eq(zvgListings.plz, exactPlz));
        }
        if (criteria.plz_lat != null && criteria.plz_lng != null && criteria.umkreis_km != null) {
          const box = alertRadiusBoundingBox(criteria);
          const inRadiusBox = box
            ? and(
                isNotNull(zvgListings.lat),
                isNotNull(zvgListings.lng),
                sql`(${zvgListings.lat})::double precision BETWEEN ${box.minLat} AND ${box.maxLat}`,
                sql`(${zvgListings.lng})::double precision BETWEEN ${box.minLng} AND ${box.maxLng}`,
              )
            : and(isNotNull(zvgListings.lat), isNotNull(zvgListings.lng));
          const matchable = criteria.plz
            ? or(inRadiusBox, eq(zvgListings.plz, criteria.plz))
            : inRadiusBox;
          if (matchable) conditions.push(matchable);
        }
        conditions.push(sql`NOT EXISTS (
          SELECT 1 FROM alert_notifications n
          WHERE n.alert_id = ${alert.id}
            AND n.listing_id = ${zvgListings.id}
        )`);

        processed++;

        const toSend: Array<{
          id: string;
          typ: string | null;
          adresse: string | null;
          verkehrswert: string | null;
          slug: string;
          bundesland: string;
          amtsgericht: string | null;
          terminDate: Date | null;
          lat: string | null;
          lng: string | null;
          plz: string | null;
        }> = [];
        for (
          let page = 0;
          page < ALERT_MATCH_MAX_PAGES && toSend.length < MAX_LISTINGS_PER_EMAIL;
          page++
        ) {
          const candidates = await db
            .select({
              id: zvgListings.id,
              typ: zvgListings.typ,
              adresse: zvgListings.adresse,
              verkehrswert: zvgListings.verkehrswert,
              slug: zvgListings.slug,
              bundesland: zvgListings.bundesland,
              amtsgericht: zvgListings.amtsgericht,
              terminDate: zvgListings.terminDate,
              lat: zvgListings.lat,
              lng: zvgListings.lng,
              plz: zvgListings.plz,
            })
            .from(zvgListings)
            .where(and(...conditions))
            .orderBy(desc(zvgListings.createdAt), desc(zvgListings.id))
            .limit(ALERT_MATCH_PAGE_SIZE)
            .offset(page * ALERT_MATCH_PAGE_SIZE);

          if (candidates.length === 0) break;

          const filtered = candidates.filter((c) => listingMatchesAlertRadius(c, criteria));

          if (filtered.length === 0) continue;

          const pageNew = takeUnnotifiedAlertMatches(
            filtered,
            new Set(),
            MAX_LISTINGS_PER_EMAIL - toSend.length,
          );
          toSend.push(...pageNew);
        }

        if (toSend.length === 0) {
          await markAlertChecked(alert.id, now);
          continue;
        }

        const coverImages = toSend.length
          ? await db
              .select({ listingId: zvgImages.listingId, publicUrl: zvgImages.publicUrl })
              .from(zvgImages)
              .where(
                inArray(
                  zvgImages.listingId,
                  toSend.map((t) => t.id),
                ),
              )
              .orderBy(...LISTING_COVER_ORDER)
          : [];
        const coverByListing = new Map<string, string | null>();
        for (const cover of coverImages) {
          if (!cover.listingId || coverByListing.has(cover.listingId)) continue;
          coverByListing.set(cover.listingId, cover.publicUrl);
        }
        const listingIds = toSend.map((m) => m.id);

        let sentCount = 0;
        await db.transaction(async (tx) => {
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtext(${`alert-send:${alert.id}`}))`,
          );
          const already = await tx
            .select({ listingId: alertNotifications.listingId })
            .from(alertNotifications)
            .where(
              and(
                eq(alertNotifications.alertId, alert.id),
                inArray(alertNotifications.listingId, listingIds),
              ),
            );
          const alreadyIds = new Set(already.map((row) => row.listingId));
          const fresh = toSend.filter((item) => !alreadyIds.has(item.id));
          if (fresh.length === 0) return;

          await sendAlertEmail({
            to: user.email,
            userName: user.name ?? user.email,
            alertName: alert.name,
            listings: fresh.map((m) => ({
              typ: m.typ ?? "Objekt",
              adresse: m.adresse ?? "–",
              verkehrswert:
                m.verkehrswert != null && Number.isFinite(Number(m.verkehrswert))
                  ? Number(m.verkehrswert)
                  : null,
              slug: m.slug,
              bundesland: m.bundesland,
              amtsgericht: m.amtsgericht,
              terminDate: m.terminDate,
              imageUrl: coverByListing.get(m.id) ?? null,
            })),
          });

          await tx
            .insert(alertNotifications)
            .values(fresh.map((item) => ({ alertId: alert.id, listingId: item.id })));
          await tx
            .update(userAlerts)
            .set({ lastTriggeredAt: now })
            .where(eq(userAlerts.id, alert.id));
          sentCount = fresh.length;
        });

        if (sentCount === 0) continue;
        newMatches += sentCount;
        emails++;
      } catch (err) {
        console.error(`[cron/check-alerts] Alert ${alert.id}`, err);
        errors.push(`Alert ${alert.id}: Versand fehlgeschlagen`);
      }
    }
  } catch (err) {
    console.error("[cron/check-alerts]", err);
    return NextResponse.json(
      { error: "Interner Fehler" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    await pruneExpiredOperationalRows();
  } catch (err) {
    console.error("[cron/check-alerts] Retention fehlgeschlagen", err);
    errors.push("Retention fehlgeschlagen");
  }

  return NextResponse.json(
    {
      ok: true,
      processed,
      emails,
      newMatches,
      skippedMissingGeocode,
      errors: errors.length ? errors : undefined,
      timestamp: now.toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(req: NextRequest) {
  return runCheckAlerts(req);
}

export async function POST(req: NextRequest) {
  return runCheckAlerts(req);
}
