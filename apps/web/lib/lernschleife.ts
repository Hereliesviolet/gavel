import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { fetchPicksByListingIds } from "@/lib/investor-queries";
import { getInvestorProfile } from "@/lib/investor-profile-storage";

/**
 * Die Lernschleife vergleicht, was das Modell gesagt hat, mit dem, was
 * tatsächlich passiert ist, und zeigt, wie sich die Datenabdeckung über die
 * Zeit entwickelt. Beides bleibt bewusst roh: ohne ausreichend erfasste
 * Ergebnisse wird nichts geglättet und nichts nachjustiert, sondern die
 * fehlende Stichprobe ausgewiesen.
 */

/** Unter dieser Zahl an Beobachtungen ist eine Abweichung Zufall, kein Signal. */
export const MIN_KALIBRIERUNG_STICHPROBE = 5;

export interface Beobachtung {
  gebotEur: number | null;
  maxGebotEur: number | null;
  verkaufspreisEur: number | null;
  arvMinEur: number | null;
  arvMaxEur: number | null;
  mieteEur: number | null;
  mietansatzEur: number | null;
  sanierungEur: number | null;
  sanierungMinEur: number | null;
  sanierungMaxEur: number | null;
}

export interface KalibrierungsZeile {
  groesse: string;
  stichprobe: number;
  medianAbweichungPct: number | null;
  innerhalbSpanne: number | null;
  bedeutung: string;
}

export interface Kalibrierungsreport {
  erfassteErgebnisse: number;
  mitZahlen: number;
  zeilen: KalibrierungsZeile[];
}

function median(werte: number[]): number | null {
  if (werte.length === 0) return null;
  const sortiert = [...werte].sort((a, b) => a - b);
  const mitte = Math.floor(sortiert.length / 2);
  const wert =
    sortiert.length % 2 === 0 ? (sortiert[mitte - 1] + sortiert[mitte]) / 2 : sortiert[mitte];
  return Math.round(wert * 10) / 10;
}

function abweichungPct(ist: number, modell: number): number | null {
  return Number.isFinite(modell) && modell > 0 ? ((ist - modell) / modell) * 100 : null;
}

interface Sammler {
  abweichungen: number[];
  inSpanne: number;
  mitSpanne: number;
}

function leererSammler(): Sammler {
  return { abweichungen: [], inSpanne: 0, mitSpanne: 0 };
}

function gegenSpanne(
  sammler: Sammler,
  ist: number | null,
  min: number | null,
  max: number | null,
): boolean {
  if (ist == null || min == null || max == null) return false;
  const wert = abweichungPct(ist, (min + max) / 2);
  if (wert == null) return false;
  sammler.abweichungen.push(wert);
  sammler.mitSpanne += 1;
  if (ist >= min && ist <= max) sammler.inSpanne += 1;
  return true;
}

function gegenPunktwert(sammler: Sammler, ist: number | null, modell: number | null): boolean {
  if (ist == null || modell == null) return false;
  const wert = abweichungPct(ist, modell);
  if (wert == null) return false;
  sammler.abweichungen.push(wert);
  return true;
}

function quote(treffer: number, gesamt: number): number | null {
  return gesamt === 0 ? null : Math.round((treffer / gesamt) * 100);
}

export function berechneKalibrierung(beobachtungen: Beobachtung[]): {
  mitZahlen: number;
  zeilen: KalibrierungsZeile[];
} {
  const gebot = leererSammler();
  const verkauf = leererSammler();
  const miete = leererSammler();
  const sanierung = leererSammler();
  let mitZahlen = 0;

  for (const b of beobachtungen) {
    const treffer = [
      gegenPunktwert(gebot, b.gebotEur, b.maxGebotEur),
      gegenSpanne(verkauf, b.verkaufspreisEur, b.arvMinEur, b.arvMaxEur),
      gegenPunktwert(miete, b.mieteEur, b.mietansatzEur),
      gegenSpanne(sanierung, b.sanierungEur, b.sanierungMinEur, b.sanierungMaxEur),
    ];
    if (treffer.some(Boolean)) mitZahlen += 1;
  }

  return {
    mitZahlen,
    zeilen: [
      {
        groesse: "Gebot gegen Maximalgebot",
        stichprobe: gebot.abweichungen.length,
        medianAbweichungPct: median(gebot.abweichungen),
        innerhalbSpanne: null,
        bedeutung:
          "Über null heißt: wir bieten regelmäßig über der Modellgrenze — entweder ist das Modell zu streng oder wir sind es nicht.",
      },
      {
        groesse: "Verkaufspreis gegen ARV",
        stichprobe: verkauf.abweichungen.length,
        medianAbweichungPct: median(verkauf.abweichungen),
        innerhalbSpanne: quote(verkauf.inSpanne, verkauf.mitSpanne),
        bedeutung:
          "Systematisch negativ heißt: die ARV-Schätzung ist zu optimistisch und jede Flip-Marge zu hoch.",
      },
      {
        groesse: "Miete gegen Mietansatz",
        stichprobe: miete.abweichungen.length,
        medianAbweichungPct: median(miete.abweichungen),
        innerhalbSpanne: null,
        bedeutung:
          "Prüft Marktreferenz und Gutachtenmiete gegen die tatsächlich erzielte Kaltmiete.",
      },
      {
        groesse: "Sanierung gegen Kostenschätzung",
        stichprobe: sanierung.abweichungen.length,
        medianAbweichungPct: median(sanierung.abweichungen),
        innerhalbSpanne: quote(sanierung.inSpanne, sanierung.mitSpanne),
        bedeutung:
          "Über null heißt: die Kostenschätzung deckt die Realität nicht, der Sicherheitsaufschlag muss steigen.",
      },
    ],
  };
}

interface OutcomeZeile {
  listing_id: string;
  strategy: string | null;
  actual_bid_eur: number | null;
  actual_purchase_price_eur: number | null;
  actual_renovation_eur: number | null;
  actual_monthly_rent_eur: number | null;
  actual_sale_price_eur: number | null;
  arv_min_eur: number | null;
  arv_max_eur: number | null;
  moegliche_kaltmiete: string | null;
  fix_flip_gesamtkosten_min_eur: number | null;
  fix_flip_gesamtkosten_max_eur: number | null;
}

function zahl(wert: unknown): number | null {
  if (wert == null) return null;
  const n = Number(wert);
  return Number.isFinite(n) ? n : null;
}

export async function fetchKalibrierung(userId: string): Promise<Kalibrierungsreport> {
  const zeilen = (await db.execute(sql`
      SELECT
        o.listing_id::text AS listing_id,
        o.strategy,
        o.actual_bid_eur,
        o.actual_purchase_price_eur,
        o.actual_renovation_eur,
        o.actual_monthly_rent_eur,
        o.actual_sale_price_eur,
        k.arv_min_eur,
        k.arv_max_eur,
        k.moegliche_kaltmiete,
        k.fix_flip_gesamtkosten_min_eur,
        k.fix_flip_gesamtkosten_max_eur
      FROM investor_deal_outcomes o
      INNER JOIN zvg_listings l ON l.id = o.listing_id AND l.needs_review = false
      LEFT JOIN zvg_ki_analyses k ON k.listing_id = l.id
      WHERE o.status IN ('bid', 'acquired', 'sold')
        AND o.user_id = ${userId}
    `)) as unknown as Array<OutcomeZeile>;

  const [gesamt] = (await db.execute(sql`
      SELECT count(*)::int AS anzahl FROM investor_deal_outcomes
      WHERE user_id = ${userId}
    `)) as unknown as Array<{ anzahl: number }>;

  const profile = await getInvestorProfile(userId);
  const preferredStrategyByListingId = Object.fromEntries(
    zeilen.map((zeile) => [zeile.listing_id, zeile.strategy]),
  );
  const picks =
    zeilen.length > 0
      ? await fetchPicksByListingIds(
          zeilen.map((z) => z.listing_id),
          profile,
          preferredStrategyByListingId,
        )
      : new Map();

  const beobachtungen = zeilen.map<Beobachtung>((zeile) => {
    const pick = picks.get(zeile.listing_id);
    return {
      gebotEur: zahl(zeile.actual_bid_eur),
      maxGebotEur: zahl(pick?.metrics.maxBidEur),
      verkaufspreisEur: zahl(zeile.actual_sale_price_eur),
      arvMinEur: pick ? zahl(zeile.arv_min_eur) : null,
      arvMaxEur: pick ? zahl(zeile.arv_max_eur) : null,
      mieteEur: zahl(zeile.actual_monthly_rent_eur),
      mietansatzEur: zahl(pick?.metrics.mieteEur),
      sanierungEur: zahl(zeile.actual_renovation_eur),
      sanierungMinEur: pick ? zahl(zeile.fix_flip_gesamtkosten_min_eur) : null,
      sanierungMaxEur: pick ? zahl(zeile.fix_flip_gesamtkosten_max_eur) : null,
    };
  });

  return {
    erfassteErgebnisse: Number(gesamt?.anzahl ?? 0),
    ...berechneKalibrierung(beobachtungen),
  };
}

export interface AbdeckungsStand {
  merkmal: string;
  anzahl: number;
  gesamt: number;
  grundgesamtheit?: string;
}

export interface VerlaufsPunkt {
  datum: Date;
  gesamt: number;
  durchschnittChance: number | null;
  abdeckung: AbdeckungsStand[];
}

interface VerlaufsZeile {
  created_at: Date;
  sample_size: number;
  metrics: {
    averageChance?: number;
    abdeckung?: AbdeckungsStand[];
  };
}

export async function fetchAbdeckungsverlauf(limit = 12): Promise<VerlaufsPunkt[]> {
  const zeilen = (await db.execute(sql`
      SELECT created_at, sample_size, metrics
      FROM investor_evaluation_runs
      WHERE metrics ? 'abdeckung'
      ORDER BY created_at DESC
      LIMIT ${limit}
    `)) as unknown as Array<VerlaufsZeile>;

  return zeilen
    .map((zeile) => ({
      datum: new Date(zeile.created_at),
      gesamt: Number(zeile.sample_size ?? 0),
      durchschnittChance: zeile.metrics?.averageChance ?? null,
      abdeckung: zeile.metrics?.abdeckung ?? [],
    }))
    .reverse();
}

export interface AbdeckungsVergleich {
  merkmal: string;
  vorherPct: number;
  nachherPct: number;
  /** null, wenn beide Läufe verschiedene Bezugsmengen zählen. */
  deltaPp: number | null;
}

/**
 * Läufe vor dem 12.08.2026 haben die Bezugsmenge nicht mitgeschrieben; damals
 * zählte jede Zeile gegen den gesamten aktiven Bestand.
 */
const GRUNDGESAMTHEIT_ALTBESTAND = "alle aktiven Objekte";

function prozent(anzahl: number, gesamt: number): number {
  return gesamt > 0 ? Math.round((anzahl / gesamt) * 100) : 0;
}

/**
 * Vergleicht zwei Abdeckungsstände. Zählt eine Zeile inzwischen gegen eine
 * andere Bezugsmenge, entfällt die Veränderung: eine geänderte Definition sieht
 * sonst wie Fortschritt aus. Die Wohnfläche zählt seit dem 12.08.2026 nur noch
 * Häuser und Wohnungen und sprang dadurch scheinbar um 20 Punkte, während die
 * absolute Zahl sogar sank.
 */
export function vergleicheAbdeckung(
  frueher: AbdeckungsStand[],
  jetzt: AbdeckungsStand[],
): AbdeckungsVergleich[] {
  return jetzt.flatMap((nachher) => {
    const vorher = frueher.find((eintrag) => eintrag.merkmal === nachher.merkmal);
    if (!vorher) return [];
    const vorherPct = prozent(vorher.anzahl, vorher.gesamt);
    const nachherPct = prozent(nachher.anzahl, nachher.gesamt);
    const gleicheGrundlage =
      (vorher.grundgesamtheit ?? GRUNDGESAMTHEIT_ALTBESTAND) ===
      (nachher.grundgesamtheit ?? GRUNDGESAMTHEIT_ALTBESTAND);
    return [
      {
        merkmal: nachher.merkmal,
        vorherPct,
        nachherPct,
        deltaPp: gleicheGrundlage ? nachherPct - vorherPct : null,
      },
    ];
  });
}
