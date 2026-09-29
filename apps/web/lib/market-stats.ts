import { db } from "@/lib/db";
import { zvgListings, zvgKiAnalyses } from "@/drizzle/schema";
import { count, avg, eq, gte, gt, desc, asc, sql, isNotNull, and, lt } from "drizzle-orm";
import { peerKategorieSql } from "@/lib/listing-type-filter";
import {
  addZonedCalendarDays,
  calendarDaysUntil,
  exclusiveZonedCalendarHorizon,
  startOfZonedDay,
} from "@/lib/utils";
import { upcomingTerminSql } from "@/lib/termin-sql";

export async function getMarketStats() {
  try {
    const activeQuality = and(eq(zvgListings.istAktiv, true), eq(zvgListings.needsReview, false));

    const [total] = await db.select({ count: count() }).from(zvgListings).where(activeQuality);

    const siebenTageAgo = addZonedCalendarDays(startOfZonedDay(), -7);
    const [neuLetzteWoche] = await db
      .select({ count: count() })
      .from(zvgListings)
      .where(and(activeQuality, gte(zvgListings.createdAt, siebenTageAgo)));

    const [avgPreis] = await db
      .select({ avg: avg(zvgListings.verkehrswert) })
      .from(zvgListings)
      .where(activeQuality);

    const bundeslaenderRows = await db
      .select({ bundesland: zvgListings.bundesland })
      .from(zvgListings)
      .where(activeQuality)
      .groupBy(zvgListings.bundesland);

    const [kiCount] = await db
      .select({ count: count() })
      .from(zvgKiAnalyses)
      .innerJoin(zvgListings, eq(zvgKiAnalyses.listingId, zvgListings.id))
      .where(activeQuality);

    const [exposeCount] = await db
      .select({ count: count() })
      .from(zvgListings)
      .where(and(activeQuality, isNotNull(zvgListings.exposeUrl)));

    const nachBundesland = await db
      .select({
        bundesland: zvgListings.bundesland,
        bundeslandName: zvgListings.bundeslandName,
        count: count(),
        avgVw: avg(zvgListings.verkehrswert),
      })
      .from(zvgListings)
      .where(activeQuality)
      .groupBy(zvgListings.bundesland, zvgListings.bundeslandName)
      .orderBy(desc(count()));

    const peerKat = peerKategorieSql();
    const nachKategorie = await db
      .select({ kategorie: peerKat, count: count() })
      .from(zvgListings)
      .where(activeQuality)
      .groupBy(peerKat)
      .orderBy(desc(count()));

    const vwVerteilung = await db
      .select({
        bracket: sql<string>`CASE
          WHEN verkehrswert::numeric < 50000 THEN '< 50k'
          WHEN verkehrswert::numeric < 100000 THEN '50–100k'
          WHEN verkehrswert::numeric < 200000 THEN '100–200k'
          WHEN verkehrswert::numeric < 500000 THEN '200–500k'
          WHEN verkehrswert::numeric < 1000000 THEN '500k–1M'
          ELSE '> 1M'
        END`,
        anzahl: count(),
      })
      .from(zvgListings)
      .where(and(activeQuality, isNotNull(zvgListings.verkehrswert)))
      .groupBy(
        sql`CASE
          WHEN verkehrswert::numeric < 50000 THEN '< 50k'
          WHEN verkehrswert::numeric < 100000 THEN '50–100k'
          WHEN verkehrswert::numeric < 200000 THEN '100–200k'
          WHEN verkehrswert::numeric < 500000 THEN '200–500k'
          WHEN verkehrswert::numeric < 1000000 THEN '500k–1M'
          ELSE '> 1M'
        END`,
      )
      .orderBy(sql`MIN(verkehrswert::numeric)`);

    const jetzt = new Date();
    const naechsteTermine = await db
      .select({
        id: zvgListings.id,
        slug: zvgListings.slug,
        aktenzeichen: zvgListings.aktenzeichen,
        bundesland: zvgListings.bundesland,
        bundeslandName: zvgListings.bundeslandName,
        adresse: zvgListings.adresse,
        ort: zvgListings.ort,
        verkehrswert: zvgListings.verkehrswert,
        terminDate: zvgListings.terminDate,
        amtsgericht: zvgListings.amtsgericht,
        typ: zvgListings.typ,
      })
      .from(zvgListings)
      .where(and(activeQuality, upcomingTerminSql()))
      .orderBy(asc(zvgListings.terminDate), asc(zvgListings.id))
      .limit(10);

    const h7 = exclusiveZonedCalendarHorizon(7).toISOString();
    const h14 = exclusiveZonedCalendarHorizon(14).toISOString();
    const h30 = exclusiveZonedCalendarHorizon(30).toISOString();
    const [dringlichkeit] = await db
      .select({
        in7: sql<number>`COUNT(*) FILTER (WHERE ${upcomingTerminSql()} AND termin_date < ${h7}::timestamptz)`.mapWith(
          Number,
        ),
        in14: sql<number>`COUNT(*) FILTER (WHERE ${upcomingTerminSql()} AND termin_date < ${h14}::timestamptz)`.mapWith(
          Number,
        ),
        in30: sql<number>`COUNT(*) FILTER (WHERE ${upcomingTerminSql()} AND termin_date < ${h30}::timestamptz)`.mapWith(
          Number,
        ),
      })
      .from(zvgListings)
      .where(activeQuality);

    const preiseNachKategorie = await db
      .select({
        kategorie: peerKat,
        avg: sql<number>`AVG(verkehrswert::numeric)`.mapWith(Number),
        min: sql<number>`MIN(verkehrswert::numeric)`.mapWith(Number),
        max: sql<number>`MAX(verkehrswert::numeric)`.mapWith(Number),
        count: sql<number>`COUNT(*)`.mapWith(Number),
      })
      .from(zvgListings)
      .where(and(activeQuality, isNotNull(zvgListings.verkehrswert)))
      .groupBy(peerKat);

    const topAmtsgerichte = await db
      .select({
        amtsgericht: zvgListings.amtsgericht,
        count: sql<number>`COUNT(*)`.mapWith(Number),
        avgPreis: sql<number>`AVG(verkehrswert::numeric)`.mapWith(Number),
      })
      .from(zvgListings)
      .where(and(activeQuality, isNotNull(zvgListings.amtsgericht)))
      .groupBy(zvgListings.amtsgericht)
      .orderBy(desc(sql`COUNT(*)`))
      .limit(10);

    const termineProMonat = await db
      .select({
        monat: sql<string>`TO_CHAR(termin_date AT TIME ZONE 'Europe/Berlin', 'YYYY-MM')`,
        monatLabel: sql<string>`TO_CHAR(termin_date AT TIME ZONE 'Europe/Berlin', 'Mon YYYY')`,
        count: sql<number>`COUNT(*)`.mapWith(Number),
      })
      .from(zvgListings)
      .where(
        and(
          activeQuality,
          upcomingTerminSql(),
          lt(zvgListings.terminDate, exclusiveZonedCalendarHorizon(90)),
        ),
      )
      .groupBy(
        sql`TO_CHAR(termin_date AT TIME ZONE 'Europe/Berlin', 'YYYY-MM')`,
        sql`TO_CHAR(termin_date AT TIME ZONE 'Europe/Berlin', 'Mon YYYY')`,
      )
      .orderBy(sql`TO_CHAR(termin_date AT TIME ZONE 'Europe/Berlin', 'YYYY-MM')`);

    const topChancen = await db
      .select({
        id: zvgListings.id,
        slug: zvgListings.slug,
        bundesland: zvgListings.bundesland,
        adresse: zvgListings.adresse,
        ort: zvgListings.ort,
        verkehrswert: zvgListings.verkehrswert,
        wohnflaecheM2: zvgListings.wohnflaecheM2,
        preisProM2: sql<number>`(verkehrswert::numeric / wohnflaeche_m2::numeric)`.mapWith(Number),
        terminDate: zvgListings.terminDate,
      })
      .from(zvgListings)
      .where(
        and(
          activeQuality,
          isNotNull(zvgListings.verkehrswert),
          isNotNull(zvgListings.wohnflaecheM2),
          gt(zvgListings.wohnflaecheM2, sql`0`),
          gt(zvgListings.verkehrswert, sql`0`),
        ),
      )
      .orderBy(asc(sql`verkehrswert::numeric / wohnflaeche_m2::numeric`))
      .limit(5);

    const [datenQualitaet] = await db
      .select({
        gesamt: sql<number>`COUNT(*)`.mapWith(Number),
        mitBild: sql<number>`COUNT(*) FILTER (WHERE EXISTS (
                     SELECT 1 FROM zvg_images img WHERE img.listing_id = zvg_listings.id
                   ))`.mapWith(Number),
        mitKi: sql<number>`COUNT(*) FILTER (WHERE EXISTS (
                     SELECT 1 FROM zvg_ki_analyses ki WHERE ki.listing_id = zvg_listings.id
                   ))`.mapWith(Number),
        mitDirektlink: sql<number>`COUNT(*) FILTER (WHERE direktlink IS NOT NULL)`.mapWith(Number),
      })
      .from(zvgListings)
      .where(activeQuality);

    const [naechsterTermin] = await db
      .select({ terminDate: zvgListings.terminDate })
      .from(zvgListings)
      .where(and(activeQuality, upcomingTerminSql()))
      .orderBy(asc(zvgListings.terminDate), asc(zvgListings.id))
      .limit(1);

    const naechsterTerminTage = naechsterTermin?.terminDate
      ? calendarDaysUntil(naechsterTermin.terminDate, jetzt)
      : null;

    return {
      total: total.count,
      neuLetzteWoche: neuLetzteWoche.count,
      avgPreis: Number(avgPreis.avg ?? 0),
      anzahlBundeslaender: bundeslaenderRows.length,
      kiCount: kiCount.count,
      exposeCount: exposeCount.count,
      naechsterTerminTage,
      nachBundesland: nachBundesland.map((b) => ({
        bundesland: b.bundesland,
        bundeslandName: b.bundeslandName,
        count: b.count,
        avgVw: b.avgVw,
      })),
      nachKategorie,
      vwVerteilung: vwVerteilung.map((v) => ({ bracket: v.bracket, anzahl: v.anzahl })),
      naechsteTermine,
      dringlichkeit: {
        in7: dringlichkeit?.in7 ?? 0,
        in14: dringlichkeit?.in14 ?? 0,
        in30: dringlichkeit?.in30 ?? 0,
      },
      preiseNachKategorie: preiseNachKategorie.map((p) => ({
        kategorie: p.kategorie ?? "Andere",
        avg: p.avg,
        min: p.min,
        max: p.max,
        count: p.count,
      })),
      topAmtsgerichte: topAmtsgerichte.map((a) => ({
        amtsgericht: a.amtsgericht ?? "—",
        count: a.count,
        avgPreis: a.avgPreis,
      })),
      termineProMonat: termineProMonat.map((t) => ({
        monat: t.monat,
        monatLabel: t.monatLabel,
        count: t.count,
      })),
      topChancen: topChancen.map((c) => ({
        id: c.id,
        slug: c.slug,
        bundesland: c.bundesland,
        adresse: c.adresse,
        ort: c.ort,
        verkehrswert: Number(c.verkehrswert),
        wohnflaecheM2: Number(c.wohnflaecheM2),
        preisProM2: c.preisProM2,
        terminDate: c.terminDate,
      })),
      datenQualitaet: {
        gesamt: datenQualitaet?.gesamt ?? 0,
        mitBild: datenQualitaet?.mitBild ?? 0,
        mitKi: datenQualitaet?.mitKi ?? 0,
        mitDirektlink: datenQualitaet?.mitDirektlink ?? 0,
      },
    };
  } catch (e) {
    console.error("[getMarketStats] DB-Fehler:", e);
    throw e;
  }
}

export type MarketStats = Awaited<ReturnType<typeof getMarketStats>>;
