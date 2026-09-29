/**
 * Kandidaten-Beförderung: aus einer geernteten Anzeige wird eine Volanalyse.
 *
 * Der Kreis schließt sich hier: jede geerntete Anzeige ist ein Vergleichswert,
 * jede Anzeige mit auffälliger Abweichung gegen ihren eigenen Mikromarkt ist
 * ein Analysekandidat, und jede fertige Analyse ist wieder ein Vergleichswert.
 *
 * Die Beförderung lebt bewusst in der Web-App und nicht im Scraper: die
 * Anti-Signal-Vorprüfung muss dieselbe Liste benutzen wie alles andere
 * (investor-risk.ts). Eine zweite Liste in Python wäre genau der Fehler, den
 * Schritt 1 beseitigt hat. Der Scraper wird nur noch über seinen bestehenden
 * Analyse-Endpunkt angestoßen.
 *
 * Ein verworfener Kandidat ist der Normalfall, kein Fehler: ein auffällig
 * niedriger Quadratmeterpreis hat auf dem freien Markt meist eine Erklärung.
 */

import { and, asc, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { marketComparables } from "@/drizzle/schema/markt";
import { realEstateListings } from "@/drizzle/schema/immobilien";
import { PUBLIC_LIVE_SCRAPE_SQL } from "@/lib/listing-privacy";
import { matchAntiSignal } from "@/lib/investor-risk";
import { MARKTREFERENZ_MIN_STICHPROBE } from "@/lib/market-reference";
import { indexListingSourceUrls, isKnownListingSourceUrl } from "@/lib/safe-url";

/** Ab diesem Abstand zum Median lohnt eine Volanalyse. */
export const KANDIDAT_MIN_ABWEICHUNG_PCT = 25;

/** Unterhalb dieses Preises je m² ist eher die Anzeige falsch als der Markt. */
export const KANDIDAT_MIN_EUR_M2 = 300;

/** Tageslimit, damit die Analysekosten kalkulierbar bleiben. */
export const KANDIDAT_TAGESLIMIT = 5;

/** Gestartete Analysen ohne öffentliche Zeile werden danach wieder offen. */
export const KANDIDAT_START_TIMEOUT_MS = 30 * 60 * 1000;

export function reconcileStartedKandidat(
  hasPublicListing: boolean,
  startedAt: Date | null,
  now = new Date(),
  timeoutMs = KANDIDAT_START_TIMEOUT_MS,
): "befoerdert" | "offen" | "gestartet" {
  if (hasPublicListing) return "befoerdert";
  if (startedAt && now.getTime() - startedAt.getTime() > timeoutMs) return "offen";
  return "gestartet";
}

/**
 * Marktspezifische Vorprüfung, zusätzlich zu den Anti-Signalen aus
 * investor-risk.ts. Auf dem freien Markt erklärt fast immer einer dieser
 * Umstände einen auffällig niedrigen Quadratmeterpreis.
 */
const MARKT_VORBEHALTE: { id: string; label: string; muster: RegExp }[] = [
  {
    id: "erbbaurecht",
    label: "Erbbaurecht",
    muster: /\b(?:erbbaurecht|erbpacht|erbbauzins)/i,
  },
  {
    id: "anteil",
    label: "Bruchteils- oder Teileigentumsanteil",
    muster: /\b(?:teileigentum|miteigentumsanteil|\d\/\d+\s*anteil|anteilsverkauf)/i,
  },
  {
    id: "mieterschutz",
    label: "Vermietet mit Mieterschutz",
    muster: /\b(?:vermietet|mieterschutz|wohnrecht|nießbrauch|lebenslange[sn]?\s+wohnrecht)/i,
  },
  {
    id: "sonderumlage",
    label: "Sanierungsstau mit Sonderumlage",
    muster: /\b(?:sonderumlage|sanierungsstau|abrissobjekt|abbruchreif)/i,
  },
  {
    id: "widmung",
    label: "Gewerbe- oder Ferienwidmung",
    muster:
      /\b(?:gewerbe|gewerblich|geschäftshaus|laden|büro|praxis|ferienhaus|ferienwohnung|wochenendhaus|datscha|gartenhaus)/i,
  },
  {
    id: "kein_volleigentum",
    label: "Kein Volleigentum oder Sonderform",
    muster: /\b(?:zwangsversteigerung|leibrente|baugrundstück|pachtgrund)/i,
  },
];

export interface KandidatBewertung {
  id: string;
  url: string;
  titel: string | null;
  mikromarkt: string;
  kategorie: string;
  preisProM2: number;
  medianEurM2: number;
  stichprobe: number;
  abweichungPct: number;
  verworfenGrund: string | null;
}

export function pruefeMarktVorbehalte(titel: string | null): string | null {
  if (!titel) return null;
  const antiSignal = matchAntiSignal(titel);
  if (antiSignal) return antiSignal.label;
  const vorbehalt = MARKT_VORBEHALTE.find((eintrag) => eintrag.muster.test(titel));
  return vorbehalt ? vorbehalt.label : null;
}

/**
 * Anzeigen, deren Quadratmeterpreis deutlich unter dem Median ihres eigenen
 * Mikromarkts liegt. Verglichen wird nur innerhalb derselben Kategorie und nur
 * bei belastbarer Stichprobe — sonst misst man die Streuung, nicht die Lücke.
 */
async function loadKnownPublicListingUrls(): Promise<Set<string>> {
  const rows = await db
    .select({ sourceUrl: realEstateListings.sourceUrl })
    .from(realEstateListings)
    .where(and(PUBLIC_LIVE_SCRAPE_SQL, isNotNull(realEstateListings.sourceUrl)));
  return indexListingSourceUrls(rows.map((row) => row.sourceUrl));
}

export async function findeKandidaten(
  limit = KANDIDAT_TAGESLIMIT * 4,
): Promise<KandidatBewertung[]> {
  const knownUrls = await loadKnownPublicListingUrls();
  const batchSize = Math.max(limit * 3, 20);
  const maxScan = 500;
  const accepted: Array<{
    id: string;
    url: string;
    titel: string | null;
    mikromarkt: string;
    kategorie: string;
    preisProM2: number;
    medianEurM2: number;
    stichprobe: number;
    abweichungPct: number;
  }> = [];
  let offset = 0;

  while (accepted.length < limit && offset < maxScan) {
    const zeilen = await db
      .select({
        id: marketComparables.id,
        url: marketComparables.url,
        titel: marketComparables.titel,
        mikromarkt: marketComparables.mikromarkt,
        kategorie: marketComparables.kategorie,
        preisProM2: sql<number>`${marketComparables.preisProM2}::numeric`.mapWith(Number),
        medianEurM2: sql<number>`ref.median_eur_m2::numeric`.mapWith(Number),
        stichprobe: sql<number>`ref.stichprobe`.mapWith(Number),
        abweichungPct: sql<number>`
          (1 - ${marketComparables.preisProM2}::numeric / ref.median_eur_m2::numeric) * 100
        `.mapWith(Number),
      })
      .from(marketComparables)
      .innerJoin(
        sql`market_reference ref`,
        sql`ref.mikromarkt = ${marketComparables.mikromarkt}
          AND ref.kategorie = ${marketComparables.kategorie}
          AND ref.angebotstyp = ${marketComparables.angebotstyp}`,
      )
      .where(
        and(
          eq(marketComparables.istAktiv, true),
          eq(marketComparables.angebotstyp, "kauf"),
          eq(marketComparables.kandidatStatus, "offen"),
          isNotNull(marketComparables.preisProM2),
          gte(marketComparables.preisProM2, String(KANDIDAT_MIN_EUR_M2)),
          sql`ref.stichprobe >= ${MARKTREFERENZ_MIN_STICHPROBE}`,
          sql`ref.median_eur_m2 > 0`,
          sql`(1 - ${marketComparables.preisProM2}::numeric / ref.median_eur_m2::numeric) * 100
              >= ${KANDIDAT_MIN_ABWEICHUNG_PCT}`,
        ),
      )
      .orderBy(
        desc(sql`(1 - ${marketComparables.preisProM2}::numeric / ref.median_eur_m2::numeric)`),
        desc(marketComparables.id),
      )
      .limit(batchSize)
      .offset(offset);

    if (zeilen.length === 0) break;
    for (const zeile of zeilen) {
      if (!isKnownListingSourceUrl(knownUrls, zeile.url)) {
        accepted.push(zeile);
        if (accepted.length >= limit) break;
      }
    }
    offset += zeilen.length;
    if (zeilen.length < batchSize) break;
  }

  return accepted.map((zeile) => ({
    ...zeile,
    verworfenGrund: pruefeMarktVorbehalte(zeile.titel),
  }));
}

async function setzeStatus(id: string, status: string, grund: string | null): Promise<void> {
  await db
    .update(marketComparables)
    .set({
      kandidatStatus: status,
      kandidatGrund: grund,
      befoerdertAm: status === "befoerdert" || status === "gestartet" ? new Date() : null,
    })
    .where(eq(marketComparables.id, id));
}

async function claimOffenenKandidat(id: string, grund: string): Promise<boolean> {
  const [row] = await db
    .update(marketComparables)
    .set({
      kandidatStatus: "gestartet",
      kandidatGrund: grund,
      befoerdertAm: new Date(),
    })
    .where(and(eq(marketComparables.id, id), eq(marketComparables.kandidatStatus, "offen")))
    .returning({ id: marketComparables.id });
  return Boolean(row);
}

async function heutigeBefoerderungen(): Promise<number> {
  const [zeile] = await db
    .select({ anzahl: sql<number>`count(*)`.mapWith(Number) })
    .from(marketComparables)
    .where(
      and(
        sql`${marketComparables.kandidatStatus} IN ('befoerdert', 'gestartet')`,
        sql`${marketComparables.befoerdertAm} > NOW() - INTERVAL '24 hours'`,
      ),
    );
  return zeile?.anzahl ?? 0;
}

async function starteAnalyse(url: string): Promise<boolean> {
  const scraperApiUrl = process.env.SCRAPER_API_URL;
  const scraperApiSecret = process.env.SCRAPER_API_SECRET;
  if (!scraperApiUrl || !scraperApiSecret) {
    throw new Error("SCRAPER_API_URL/SCRAPER_API_SECRET nicht konfiguriert");
  }
  try {
    const antwort = await fetch(`${scraperApiUrl}/internal/analyze-url-async`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${scraperApiSecret}`,
      },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(15_000),
    });
    return antwort.ok;
  } catch {
    return false;
  }
}

export interface BefoerderungsErgebnis {
  geprueft: number;
  befoerdert: { url: string; abweichungPct: number }[];
  verworfen: { url: string; grund: string }[];
  limitErreicht: boolean;
}

async function reconcileGestarteteKandidaten(): Promise<void> {
  const knownUrls = await loadKnownPublicListingUrls();
  const batchSize = 100;
  const maxBatches = 5;

  for (let batch = 0; batch < maxBatches; batch++) {
    const gestartet = await db
      .select({
        id: marketComparables.id,
        url: marketComparables.url,
        befoerdertAm: marketComparables.befoerdertAm,
      })
      .from(marketComparables)
      .where(eq(marketComparables.kandidatStatus, "gestartet"))
      .orderBy(asc(marketComparables.befoerdertAm), asc(marketComparables.id))
      .limit(batchSize);

    if (gestartet.length === 0) return;

    let changed = 0;
    for (const kandidat of gestartet) {
      const next = reconcileStartedKandidat(
        isKnownListingSourceUrl(knownUrls, kandidat.url),
        kandidat.befoerdertAm,
      );
      if (next !== "gestartet") {
        await setzeStatus(
          kandidat.id,
          next,
          next === "offen" ? "Analyse nicht abgeschlossen" : null,
        );
        changed += 1;
      }
    }
    if (changed === 0) return;
  }
}

export async function befoerdereKandidaten(
  tageslimit = KANDIDAT_TAGESLIMIT,
): Promise<BefoerderungsErgebnis> {
  await reconcileGestarteteKandidaten();
  const bereitsHeute = await heutigeBefoerderungen();
  const rest = Math.max(0, tageslimit - bereitsHeute);
  const kandidaten = await findeKandidaten();

  const ergebnis: BefoerderungsErgebnis = {
    geprueft: kandidaten.length,
    befoerdert: [],
    verworfen: [],
    limitErreicht: rest === 0 && kandidaten.length > 0,
  };

  for (const kandidat of kandidaten) {
    if (kandidat.verworfenGrund) {
      await setzeStatus(kandidat.id, "verworfen", kandidat.verworfenGrund);
      ergebnis.verworfen.push({ url: kandidat.url, grund: kandidat.verworfenGrund });
      continue;
    }
    if (ergebnis.befoerdert.length >= rest) {
      ergebnis.limitErreicht = true;
      break;
    }
    const grund = `${kandidat.abweichungPct.toFixed(0)} % unter dem Angebots-Median (n=${kandidat.stichprobe})`;
    const claimed = await claimOffenenKandidat(kandidat.id, grund);
    if (!claimed) continue;
    const gestartet = await starteAnalyse(kandidat.url);
    if (!gestartet) {
      await setzeStatus(kandidat.id, "offen", "Analyse konnte nicht gestartet werden");
      continue;
    }
    ergebnis.befoerdert.push({
      url: kandidat.url,
      abweichungPct: Math.round(kandidat.abweichungPct),
    });
  }

  return ergebnis;
}
