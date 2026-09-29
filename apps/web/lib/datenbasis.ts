import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { zvgListings } from "@/drizzle/schema";
import { marktKategorieSql, mikromarktSql, peerKategorieSql } from "@/lib/listing-type-filter";
import { MARKTREFERENZ_MAX_ALTER_TAGE, MARKTREFERENZ_MIN_STICHPROBE } from "@/lib/market-reference";

export interface AbdeckungsZeile {
  merkmal: string;
  anzahl: number;
  gesamt: number;
  /** Worauf sich die Quote bezieht — nicht jede Zahl kann jedes Objekt haben. */
  grundgesamtheit: string;
  bedeutung: string;
}

export interface DatenbasisReport {
  abdeckung: AbdeckungsZeile[];
  markt: {
    vergleichsobjekte: number;
    mikromaerkte: number;
    mikromaerkteBelastbar: number;
    juengsteErnte: Date | null;
  };
  historie: {
    ereignisse: number;
    seit: Date | null;
    objekteMitWiederholung: number;
  };
}

/**
 * Der Abdeckungsbericht ist kein Nice-to-have: solange Miete, ARV und
 * Marktreferenz nur für einen Teil des Bestands belastbar sind, ist die
 * Abdeckungsquote die ehrlichste Aussage über die Reichweite jeder Empfehlung.
 */
export async function fetchDatenbasis(): Promise<DatenbasisReport> {
  const peerKat = peerKategorieSql();
  const mikromarkt = mikromarktSql();
  const marktKat = marktKategorieSql();
  const referenzBelastbar = sql`
    r.mikromarkt = ${mikromarkt}
    AND r.kategorie = ${marktKat}
    AND r.stichprobe >= ${MARKTREFERENZ_MIN_STICHPROBE}
    AND r.median_eur_m2 > 0
    AND (
      r.stand IS NULL
      OR (
        (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Berlin')::date
        - (r.stand AT TIME ZONE 'Europe/Berlin')::date
      ) <= ${MARKTREFERENZ_MAX_ALTER_TAGE}
    )
  `;
  const [bestand] = (await db.execute(sql`
      SELECT
        count(*)::int AS gesamt,
        count(k.id)::int AS mit_analyse,
        count(*) FILTER (WHERE ${peerKat} IN ('haus', 'wohnung'))::int AS wohnobjekte,
        count(*) FILTER (
          WHERE ${peerKat} IN ('haus', 'wohnung') AND ${zvgListings.wohnflaecheM2} IS NOT NULL
        )::int AS mit_wohnflaeche,
        count(*) FILTER (WHERE k.arv_min_eur IS NOT NULL)::int AS mit_arv,
        count(*) FILTER (WHERE k.moegliche_kaltmiete IS NOT NULL)::int AS mit_miete,
        count(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM market_reference r
          WHERE ${referenzBelastbar}
            AND r.angebotstyp = 'miete'
        ))::int AS mit_mietreferenz,
        count(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM market_reference r
          WHERE ${referenzBelastbar}
            AND r.angebotstyp = 'kauf'
        ))::int AS mit_marktreferenz,
        count(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM zvg_auction_events e
          WHERE e.listing_id = ${zvgListings.id} AND e.geringstes_gebot IS NOT NULL
            AND (e.termin_date AT TIME ZONE 'Europe/Berlin')::date
              IS NOT DISTINCT FROM (${zvgListings.terminDate} AT TIME ZONE 'Europe/Berlin')::date
        ))::int AS mit_geringstem_gebot
      FROM ${zvgListings}
      LEFT JOIN zvg_ki_analyses k ON k.listing_id = ${zvgListings.id}
      WHERE ${zvgListings.istAktiv} AND ${zvgListings.needsReview} = false
    `)) as unknown as Array<{
    gesamt: number;
    mit_analyse: number;
    mit_wohnflaeche: number;
    mit_arv: number;
    mit_miete: number;
    mit_mietreferenz: number;
    mit_marktreferenz: number;
    mit_geringstem_gebot: number;
    wohnobjekte: number;
  }>;

  const [markt] = (await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM market_comparables) AS vergleichsobjekte,
        (SELECT count(DISTINCT mikromarkt)::int FROM market_reference) AS mikromaerkte,
        (SELECT count(DISTINCT mikromarkt)::int FROM market_reference
          WHERE stichprobe >= ${MARKTREFERENZ_MIN_STICHPROBE}) AS belastbar,
        (SELECT max(zuletzt_gesehen_am) FROM market_comparables) AS juengste
    `)) as unknown as Array<{
    vergleichsobjekte: number;
    mikromaerkte: number;
    belastbar: number;
    juengste: Date | null;
  }>;

  const [historie] = (await db.execute(sql`
      SELECT
        count(*)::int AS ereignisse,
        min(e.erfasst_am) AS seit,
        (SELECT count(*)::int FROM (
          SELECT e2.listing_id FROM zvg_auction_events e2
          INNER JOIN zvg_listings l2 ON l2.id = e2.listing_id
          WHERE e2.termin_date IS NOT NULL
            AND l2.ist_aktiv AND l2.needs_review = false
          GROUP BY e2.listing_id HAVING count(DISTINCT e2.termin_date) > 1
        ) AS w) AS wiederholungen
      FROM zvg_auction_events e
      INNER JOIN zvg_listings l ON l.id = e.listing_id
      WHERE l.ist_aktiv AND l.needs_review = false
    `)) as unknown as Array<{
    ereignisse: number;
    seit: Date | null;
    wiederholungen: number;
  }>;

  const gesamt = Number(bestand?.gesamt ?? 0);
  const wohnobjekte = Number(bestand?.wohnobjekte ?? 0);
  const ALLE = "alle aktiven Objekte";
  const zeile = (
    merkmal: string,
    anzahl: number | undefined,
    bedeutung: string,
    bezug = gesamt,
    grundgesamtheit = ALLE,
  ): AbdeckungsZeile => ({
    merkmal,
    anzahl: Number(anzahl ?? 0),
    gesamt: bezug,
    grundgesamtheit,
    bedeutung,
  });

  return {
    abdeckung: [
      zeile(
        "KI-Analyse vorhanden",
        bestand?.mit_analyse,
        "Ohne Analyse gibt es weder Chance noch Underwriting.",
      ),
      zeile(
        "Wohnfläche bekannt",
        bestand?.mit_wohnflaeche,
        "Voraussetzung für jeden Preis je Quadratmeter und damit für den Marktvergleich. Grundstücke und Gewerbe haben keine Wohnfläche und zählen hier nicht mit. Was fehlt, fehlt meist dauerhaft: die Bekanntmachung verweist auf ein kostenpflichtiges Gutachten.",
        wohnobjekte,
        "Häuser und Wohnungen",
      ),
      zeile(
        "Marktreferenz im Mikromarkt",
        bestand?.mit_marktreferenz,
        `Angebotspreise aus dem freien Markt, mindestens ${MARKTREFERENZ_MIN_STICHPROBE} Vergleichsobjekte in der Postleitzahlregion — erst ab dieser Stichprobe fließt die Referenz in Marktlücke und Chance.`,
        gesamt,
        `alle aktiven Objekte, belastbar ab n=${MARKTREFERENZ_MIN_STICHPROBE}`,
      ),
      zeile(
        "Mietreferenz im Mikromarkt",
        bestand?.mit_mietreferenz,
        "Angebotsmieten aus dem freien Markt — der bevorzugte Mietansatz für Buy & Hold. Dieselbe belastbare Stichprobe wie bei der Marktreferenz.",
        gesamt,
        `alle aktiven Objekte, belastbar ab n=${MARKTREFERENZ_MIN_STICHPROBE}`,
      ),
      zeile(
        "Mietansatz aus Gutachten oder KI",
        bestand?.mit_miete,
        "Objektbezogen, aber ohne Marktabgleich. Wird nur genutzt, wenn keine Mietreferenz vorliegt.",
      ),
      zeile(
        "ARV geschätzt",
        bestand?.mit_arv,
        "Verkaufswert nach Sanierung — Grundlage jeder Flip-Rechnung.",
      ),
      zeile(
        "Geringstes Gebot gelesen",
        bestand?.mit_geringstem_gebot,
        "Wird erst im Versteigerungstermin vom Gericht festgestellt: eine Auswertung aller hinterlegten Bekanntmachungen ergab keinen einzigen Treffer. Diese Zeile bleibt ohne Akteneinsicht bei null, das Underwriting rechnet stattdessen mit einem ausgewiesenen Referenzgebot.",
      ),
    ],
    markt: {
      vergleichsobjekte: Number(markt?.vergleichsobjekte ?? 0),
      mikromaerkte: Number(markt?.mikromaerkte ?? 0),
      mikromaerkteBelastbar: Number(markt?.belastbar ?? 0),
      juengsteErnte: markt?.juengste ? new Date(markt.juengste) : null,
    },
    historie: {
      ereignisse: Number(historie?.ereignisse ?? 0),
      seit: historie?.seit ? new Date(historie.seit) : null,
      objekteMitWiederholung: Number(historie?.wiederholungen ?? 0),
    },
  };
}
