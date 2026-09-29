import { germanPostalCode } from "@/lib/bundesland";
import { inferListingKategorie } from "@/lib/listing-kategorie";
import { calendarDaysUntil } from "@/lib/utils";

export { listingKategorieFuerPeer, listingKategorieLabel } from "@/lib/listing-kategorie";

/**
 * Unabhängige Marktreferenz aus geernteten Portal-Angeboten.
 *
 * Warum das den ZVG-Peer-Median ablöst: der Peer-Median vergleicht gerichtliche
 * Verkehrswerte gegen gerichtliche Verkehrswerte. Eine Abweichung davon sagt
 * aus, dass ein Gutachter anders geschätzt hat als andere Gutachter — nicht,
 * dass das Objekt unter Marktwert liegt. Erst ein Preis, den jemand tatsächlich
 * fordert, macht eine Unterbewertung überprüfbar.
 *
 * Der Peer-Median bleibt als sekundäre Plausibilitätszahl erhalten, klar als
 * gerichtliche Vergleichsgröße beschriftet, aber ohne Einfluss auf die Chance.
 */

/**
 * Unterhalb dieser Stichprobe wird keine Markt- oder Preislücke ausgewiesen.
 * Angebotspreise streuen stärker als gerichtliche Werte; bei einstelliger
 * Stichprobe misst man den Zufall.
 */
export const MARKTREFERENZ_MIN_STICHPROBE = 15;

/** Ab diesem Alter ist die Referenz nicht mehr aussagekräftig. */
export const MARKTREFERENZ_MAX_ALTER_TAGE = 120;

export type Angebotstyp = "kauf" | "miete";

export interface Marktreferenz {
  mikromarkt: string;
  kategorie: string;
  angebotstyp: Angebotstyp;
  medianEurM2: number;
  p25EurM2: number | null;
  p75EurM2: number | null;
  stichprobe: number;
  stand: Date | null;
}

export function mikromarktAusPlz(plz: string | null | undefined): string | null {
  const normalized = germanPostalCode(plz);
  return normalized ? normalized.slice(0, 3) : null;
}

/**
 * Vergleichbare €/m²-Referenzen gibt es nur für Wohnung und Haus.
 * Die Token kommen aus inferListingKategorie, damit Filter, Scraper und
 * Marktlücke dieselbe Objektart sehen.
 */
export function kategorieAusTyp(typ: string | null | undefined): string | null {
  const inferred = inferListingKategorie(typ);
  return inferred === "wohnung" || inferred === "haus" ? inferred : null;
}

export function listingKategorieFuerMarkt(
  kategorie: string | null | undefined,
  typ: string | null | undefined,
): string | null {
  const stored = kategorie?.trim().toLowerCase();
  if (stored === "wohnung" || stored === "haus") return stored;
  if (stored === "grundstueck" || stored === "gewerbe") return null;
  return kategorieAusTyp(typ);
}

export function istBelastbar(
  referenz: Marktreferenz | null | undefined,
  now = new Date(),
): boolean {
  if (!referenz || referenz.stichprobe < MARKTREFERENZ_MIN_STICHPROBE) return false;
  if (referenz.medianEurM2 <= 0) return false;
  if (!referenz.stand) return true;
  const age = calendarDaysUntil(referenz.stand, now);
  return age != null && -age <= MARKTREFERENZ_MAX_ALTER_TAGE;
}

/**
 * Abstand des Objektpreises zum Median vergleichbarer Angebote, in Prozent.
 * Positiv heißt: günstiger als der Markt fordert.
 */
export function berechneMarktluecke(
  preisProM2: number | null | undefined,
  referenz: Marktreferenz | null | undefined,
  now = new Date(),
): number | null {
  if (preisProM2 == null || !Number.isFinite(preisProM2) || preisProM2 <= 0) return null;
  if (!referenz || !istBelastbar(referenz, now)) return null;
  return (1 - preisProM2 / referenz.medianEurM2) * 100;
}

/**
 * Erzielbare Kaltmiete aus der Mietreferenz. Ersetzt die LLM-Mietschätzung als
 * primäre Buy-and-Hold-Basis; die Gutachtenmiete bleibt Gegenprobe.
 */
export function marktmieteEur(
  wohnflaecheM2: number | null | undefined,
  mietreferenz: Marktreferenz | null | undefined,
  now = new Date(),
): number | null {
  if (wohnflaecheM2 == null || !Number.isFinite(wohnflaecheM2) || wohnflaecheM2 <= 0) {
    return null;
  }
  if (!mietreferenz || !istBelastbar(mietreferenz, now)) return null;
  return Math.round(wohnflaecheM2 * mietreferenz.medianEurM2);
}

export function marktreferenzLabel(
  referenz: Marktreferenz | null | undefined,
  now = new Date(),
): string {
  if (!referenz) return "Keine Vergleichsangebote im Mikromarkt";
  if (istBelastbar(referenz, now)) {
    return `Angebots-Median PLZ ${referenz.mikromarkt}x · n=${referenz.stichprobe}`;
  }
  return `Stichprobe zu klein oder veraltet · n=${referenz.stichprobe}`;
}

export function referenzSchluessel(
  mikromarkt: string,
  kategorie: string,
  angebotstyp: Angebotstyp,
): string {
  return `${mikromarkt}:${kategorie}:${angebotstyp}`;
}
