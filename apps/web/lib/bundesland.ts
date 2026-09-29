import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { BUNDESLAENDER } from "./utils";

/**
 * Zentrale Bundesland-Normalisierung (Fix 2026-07-04, "Baden-Württemberg
 * unsichtbar"-Bug).
 *
 * Hintergrund: Es gab bereits einmal eine `normalizeToBundeslandSlug()` /
 * `normalizeBundeslandKey()`-Normalisierung, aber sie war 1:1 in
 * `app/page.tsx` UND `app/laender/page.tsx` dupliziert (Copy&Paste) und wurde
 * AUSSCHLIESSLICH zur Aggregation der Zähler auf Homepage/Länder-Übersicht
 * verwendet - nie für die tatsächliche Objekt-Filterung auf der
 * Bundesland-Detailseite (`app/(zvg)/[bundesland]/page.tsx`) oder in den
 * API-Routen. Dadurch zeigte die Übersicht zwar die korrekte Gesamtzahl (weil
 * dort aggregiert wurde), aber die Detailseite fand per exaktem `eq()`-Filter
 * nur die Zeilen, deren Rohwert exakt der kanonischen Schreibweise entsprach
 * - alle Schreibvarianten (Bindestrich, Umlaute, Städtenamen als Rohwert)
 * blieben dort unsichtbar. Diese Datei ist jetzt die EINZIGE Quelle für die
 * Normalisierung und wird überall verwendet, wo nach Bundesland gefiltert
 * ODER aggregiert wird.
 *
 * Kanonische Slug-Form = `BUNDESLAENDER[].slug` (siehe lib/utils.ts). Das ist
 * bewusst NICHT einheitlich "mit Bindestrich" oder "ohne Bindestrich" -
 * sondern exakt das, was aktuell live als URL-Pfad, in Sitemap/SEO und in
 * bestehenden Links/Alerts verwendet wird (z.B. weiterhin
 * "badenwuerttemberg" ohne Bindestrich, aber "nordrhein-westfalen" MIT
 * Bindestrich). Das vermeidet eine riskante URL-Migration mit
 * SEO-Auswirkungen für 15 von 16 Bundesländern und behebt stattdessen gezielt
 * die Datenqualität in der Datenbank (siehe scripts/backfill-bundesland.ts).
 */

/** Entfernt Umlaute/Sonderzeichen/Bindestriche/Leerzeichen/Groß-Kleinschreibung, liefert einen reinen a-z0-9-Schlüssel. */
function toComparableKey(raw: string): string {
  return raw
    .normalize("NFC")
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Bekannte Rohdaten-Varianten, bei denen Scraper statt des Bundeslandnamens
 * einen Orts-/Amtsgerichtssitznamen abgelegt haben (z.B. weil die Quelle nur
 * den Sitz des Amtsgerichts, nicht das Bundesland nennt). Key = normalisierter
 * Rohwert (toComparableKey), Value = kanonischer Slug aus BUNDESLAENDER.
 * Bei neuen Funden hier ergänzen (siehe Bestandsaufnahme-Query in
 * scripts/backfill-bundesland.ts).
 */
const KNOWN_ALIAS_KEY_TO_SLUG: Record<string, string> = {
  gotha: "thueringen",
  ludwigshafenamrhein: "rheinland-pfalz",
  nrw: "nordrhein-westfalen",
};

/** key(normalizedName/normalizedSlug) -> kanonischer Slug, aus BUNDESLAENDER abgeleitet (Single Source of Truth). */
const KEY_TO_CANONICAL_SLUG: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const bl of BUNDESLAENDER) {
    map[toComparableKey(bl.slug)] = bl.slug;
    map[toComparableKey(bl.name)] = bl.slug;
    map[toComparableKey(bl.kuerzel)] = bl.slug;
  }
  return map;
})();

/**
 * Bildet einen beliebigen Bundesland-Rohwert (Scraper-Output, URL-Param,
 * User-Eingabe, ...) auf die eine kanonische Slug-Schreibweise ab. Robust
 * gegenüber Bindestrichen, Leerzeichen, Groß-/Kleinschreibung und
 * ausgeschriebenen Umlauten ("ue" vs "ü"). Unbekannte Werte werden
 * best-effort durchgereicht (normalisiert, aber ohne Mapping), damit neue,
 * noch nicht kanonisierte Bundesländer nicht komplett verschluckt werden.
 */
export function normalizeBundeslandSlug(raw: string | null | undefined): string {
  if (!raw) return "";
  const key = toComparableKey(raw);
  return KNOWN_ALIAS_KEY_TO_SLUG[key] ?? KEY_TO_CANONICAL_SLUG[key] ?? key;
}

/** Vergleichsschlüssel (ohne Bindestriche) für Aggregation über Schreibvarianten hinweg. */
export function normalizeBundeslandKey(raw: string | null | undefined): string {
  return toComparableKey(normalizeBundeslandSlug(raw));
}

/**
 * SQL-Bedingung: prüft, ob eine `bundesland`-Spalte (unabhängig von
 * Bindestrich/Umlaut-Schreibweise oder Groß-/Kleinschreibung) dem
 * angegebenen kanonischen Slug entspricht. Wird zusätzlich zur DB-Migration
 * eingesetzt ("defense in depth"), damit ein einzelner künftig doch wieder
 * abweichend schreibender Scraper nicht sofort wieder Objekte auf der
 * Bundesland-Seite verschwinden lässt.
 */
export function bundeslandColumnMatches(column: AnyPgColumn, canonicalSlug: string): SQL {
  const targetKey = toComparableKey(normalizeBundeslandSlug(canonicalSlug));
  const normalizedRaw = sql`replace(replace(replace(replace(regexp_replace(lower(${column}), '[^a-z0-9äöüß]+', '', 'g'), 'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'ß', 'ss')`;

  let expr = normalizedRaw;
  for (const [aliasKey, canonical] of Object.entries(KNOWN_ALIAS_KEY_TO_SLUG)) {
    expr = sql`(CASE WHEN ${normalizedRaw} = ${aliasKey} THEN ${toComparableKey(canonical)} ELSE ${expr} END)`;
  }

  return sql`(${expr}) = ${targetKey}`;
}

/** Liefert den BUNDESLAENDER-Eintrag für einen beliebigen (auch unnormalisierten) Rohwert. */
export function findBundesland(raw: string | null | undefined) {
  const slug = normalizeBundeslandSlug(raw);
  return BUNDESLAENDER.find((bl) => bl.slug === slug);
}

export function pickTopBundeslandByCount(
  rows: Array<{
    bundesland: string | null;
    bundeslandName?: string | null;
    anzahl: number;
  }>,
): { name: string; anzahl: number } | null {
  const merged = new Map<string, number>();
  for (const row of rows) {
    const key = normalizeBundeslandKey(row.bundesland);
    if (!key) continue;
    merged.set(key, (merged.get(key) ?? 0) + Number(row.anzahl));
  }
  let topKey: string | null = null;
  let topCount = 0;
  for (const [key, anzahl] of merged) {
    if (anzahl > topCount) {
      topKey = key;
      topCount = anzahl;
    }
  }
  if (!topKey) return null;
  const bl = findBundesland(topKey);
  return { name: bl?.kuerzel ?? topKey, anzahl: topCount };
}

/**
 * Grobe PLZ→Bundesland-Zuordnung für die Custom-URL-Analyse (Ziel 2/3,
 * 2026-07-08): Custom-Listings haben nur plz/ort, aber keinen
 * Bundesland-Slug wie die ZVG-Listings. berechneErwerbskosten() (siehe
 * lib/utils.ts) braucht einen der BUNDESLAENDER-Slugs, um die richtige
 * Grunderwerbsteuer zu wählen.
 *
 * Deutsche Postleitzahlbereiche folgen NICHT exakt den Bundesländergrenzen -
 * mehrere Präfixe liegen auf Bundesland-Grenzen (z.B. 88xxx: sowohl
 * Baden-Württemberg als auch Bayern). Für solche Grenzfälle wird bewusst
 * "unbekannt" zurückgegeben, statt falsch zu raten - die aufrufende Seite
 * blendet die Erwerbskosten-Box dann aus.
 */
const PLZ_PREFIX_TO_BUNDESLAND: Record<string, string> = {
  "01": "sachsen",
  "02": "sachsen",
  "03": "brandenburg",
  "04": "sachsen",
  "06": "sachsen-anhalt",
  "07": "thueringen",
  "08": "sachsen",
  "09": "sachsen",
  "10": "berlin",
  "11": "berlin",
  "12": "berlin",
  "13": "berlin",
  "15": "brandenburg",
  "16": "brandenburg",
  "17": "mecklenburg-vorpommern",
  "18": "mecklenburg-vorpommern",
  "19": "mecklenburg-vorpommern",
  "20": "hamburg",
  "22": "hamburg",
  "23": "schleswig-holstein",
  "24": "schleswig-holstein",
  "25": "schleswig-holstein",
  "26": "niedersachsen",
  "28": "bremen",
  "29": "niedersachsen",
  "30": "niedersachsen",
  "31": "niedersachsen",
  "32": "nordrhein-westfalen",
  "33": "nordrhein-westfalen",
  "34": "hessen",
  "35": "hessen",
  "36": "hessen",
  "38": "niedersachsen",
  "39": "sachsen-anhalt",
  "40": "nordrhein-westfalen",
  "41": "nordrhein-westfalen",
  "42": "nordrhein-westfalen",
  "44": "nordrhein-westfalen",
  "45": "nordrhein-westfalen",
  "46": "nordrhein-westfalen",
  "47": "nordrhein-westfalen",
  "48": "nordrhein-westfalen",
  "49": "niedersachsen",
  "50": "nordrhein-westfalen",
  "51": "nordrhein-westfalen",
  "52": "nordrhein-westfalen",
  "54": "rheinland-pfalz",
  "55": "rheinland-pfalz",
  "56": "rheinland-pfalz",
  "57": "nordrhein-westfalen",
  "58": "nordrhein-westfalen",
  "59": "nordrhein-westfalen",
  "60": "hessen",
  "61": "hessen",
  "64": "hessen",
  "65": "hessen",
  "66": "saarland",
  "67": "rheinland-pfalz",
  "68": "badenwuerttemberg",
  "70": "badenwuerttemberg",
  "71": "badenwuerttemberg",
  "72": "badenwuerttemberg",
  "73": "badenwuerttemberg",
  "74": "badenwuerttemberg",
  "75": "badenwuerttemberg",
  "76": "badenwuerttemberg",
  "77": "badenwuerttemberg",
  "78": "badenwuerttemberg",
  "79": "badenwuerttemberg",
  "80": "bayern",
  "81": "bayern",
  "82": "bayern",
  "83": "bayern",
  "84": "bayern",
  "85": "bayern",
  "86": "bayern",
  "87": "bayern",
  "90": "bayern",
  "91": "bayern",
  "92": "bayern",
  "93": "bayern",
  "94": "bayern",
  "95": "bayern",
  "97": "bayern",
  "98": "thueringen",
  "99": "thueringen",
  // Bewusst ausgelassen (mehrere Bundesländer teilen sich den Präfix, siehe
  // Kommentar oben): 14, 21, 27, 37, 43, 53, 62, 63, 69, 88, 89, 96.
};

export function germanPostalCode(plz: string | null | undefined): string | null {
  if (!plz) return null;
  const ziffern = plz.trim().replace(/\D/g, "");
  return /^\d{5}$/.test(ziffern) ? ziffern : null;
}

export function plzToBundesland(plz: string | null | undefined): string {
  const normalized = germanPostalCode(plz);
  if (!normalized) return "unbekannt";
  return PLZ_PREFIX_TO_BUNDESLAND[normalized.substring(0, 2)] ?? "unbekannt";
}
