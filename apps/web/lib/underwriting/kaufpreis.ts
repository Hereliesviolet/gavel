/**
 * Die Kaufpreisannahme ist ein expliziter, beschrifteter Parameter.
 *
 * Vorher hatte jedes Modell seine eigene: das Underwriting rechnete mit 70 %
 * des Verkehrswerts, die Python-Flip-Rechnung mit dem vollen Verkehrswert, der
 * Detailrechner mit dem, was gerade in den Props stand. Dasselbe Objekt konnte
 * dadurch gleichzeitig "attraktiv" und "unwirtschaftlich" sein. Es gibt jetzt
 * genau eine Stelle, die entscheidet, mit welchem Preis gerechnet wird — und
 * jede Ausgabe trägt das Etikett mit.
 */

export type KaufpreisQuelle = "geringstes_gebot" | "referenzgebot" | "angebotspreis";

export interface KaufpreisAnnahme {
  eur: number;
  quelle: KaufpreisQuelle;
  /** Kurzform für die UI, z. B. "Referenzgebot 70 % des Verkehrswerts". */
  label: string;
  /** Anteil am Verkehrswert, sofern es einen gibt. */
  anteilVerkehrswertPct: number | null;
}

/** Referenzgebot, solange das geringste Gebot nicht aus der Akte gelesen ist. */
export const REFERENZGEBOT_PCT = 70;

export function kaufpreisAusZvg(
  verkehrswertEur: number | null | undefined,
  geringstesGebotEur?: number | null,
): KaufpreisAnnahme | null {
  const vw = verkehrswertEur != null && verkehrswertEur > 0 ? verkehrswertEur : null;
  if (geringstesGebotEur != null && geringstesGebotEur > 0) {
    return {
      eur: geringstesGebotEur,
      quelle: "geringstes_gebot",
      label: "Geringstes Gebot laut Terminsbestimmung",
      anteilVerkehrswertPct: vw == null ? null : (geringstesGebotEur / vw) * 100,
    };
  }
  if (vw == null) return null;
  return {
    eur: (vw * REFERENZGEBOT_PCT) / 100,
    quelle: "referenzgebot",
    label: `Referenzgebot ${REFERENZGEBOT_PCT} % des Verkehrswerts`,
    anteilVerkehrswertPct: REFERENZGEBOT_PCT,
  };
}

export function kaufpreisAusAngebot(
  angebotspreisEur: number | null | undefined,
): KaufpreisAnnahme | null {
  if (angebotspreisEur == null || angebotspreisEur <= 0) return null;
  return {
    eur: angebotspreisEur,
    quelle: "angebotspreis",
    label: "Angebotspreis der Anzeige",
    anteilVerkehrswertPct: null,
  };
}
