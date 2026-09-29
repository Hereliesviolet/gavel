/**
 * Chance und Konfidenz — der einzige sichtbare und der einzige sortierende Wert.
 *
 * Ersetzt opportunityScore, readinessScore, investmentReadinessScore,
 * qualityScore, einstiegScore und computeDisplayScore. Die alte Mischung aus
 * Signalstärke und Evidenzvollständigkeit war nicht interpretierbar: ein hoher
 * Opportunity-Score konnte auf einer einzigen Vergleichsbeobachtung beruhen,
 * und der strenge Score floss gar nicht erst in die Sortierung ein.
 *
 * Aufbau: gewichtete Summe der Hidden-Gem-Signale, bei der jedes Signal nur
 * zählt, wenn seine Datenbasis ausreicht, multipliziert mit einem
 * Datenreife-Faktor und gekappt von den Anti-Signalen.
 */

import type { PeerBenchmark } from "@/lib/investor-benchmarks";
import { calendarDaysUntil } from "@/lib/utils";
import {
  berechneMarktluecke,
  istBelastbar,
  MARKTREFERENZ_MIN_STICHPROBE,
  type Marktreferenz,
} from "@/lib/market-reference";
import type { InvestorProfile } from "@/lib/investor-profile";
import type { InvestmentUnderwriting } from "@/lib/underwriting";
import type { InvestorRiskAssessment } from "@/lib/investor-risk";

export type Datenreife = "unvollstaendig" | "bewertbar" | "verifiziert";

export type Konfidenz = "hoch" | "mittel" | "niedrig" | "keine";

/**
 * Jede Größe, die in der UI als Score oder Reifegrad auftritt. Der
 * Konformitätstest verlangt zu jedem Eintrag einen Glossarabschnitt — wer hier
 * umbenennt, ohne docs/METRICS_GLOSSARY.md nachzuziehen, bekommt einen roten
 * Test statt einer stillen Abweichung zwischen Doku und Code.
 */
export const SICHTBARE_SCORES = ["chance", "konfidenz", "datenreife"] as const;

/** Analysen ab diesem Alter gelten nicht mehr als bewertbar. */
export const ANALYSE_MAX_ALTER_TAGE = 180;

/** Ab dieser Beschreibungslänge gilt ein Exposé nicht mehr als dünn. */
export const BESCHREIBUNG_MIN_ZEICHEN = 200;

/** Unter dieser Vorlaufzeit haben andere Bieter das Objekt womöglich übersehen. */
export const KURZE_VORLAUFZEIT_TAGE = 21;

/** Obergrenze der Chance, wenn ein Anti-Signal ausgelöst hat. */
export const SONDERSITUATION_DECKEL = 25;

const DATENREIFE_FAKTOR: Record<Datenreife, number> = {
  unvollstaendig: 0.5,
  bewertbar: 0.85,
  verifiziert: 1,
};

export const DATENREIFE_LABEL: Record<Datenreife, string> = {
  unvollstaendig: "Unvollständig",
  bewertbar: "Bewertbar",
  verifiziert: "Verifiziert",
};

export const KONFIDENZ_LABEL: Record<Konfidenz, string> = {
  hoch: "Hoch",
  mittel: "Mittel",
  niedrig: "Niedrig",
  keine: "Keine",
};

export interface SignalErgebnis {
  id: string;
  label: string;
  punkte: number;
  maxPunkte: number;
  /** Begründung, wenn das Signal gefeuert hat. */
  begruendung: string | null;
  /** Benennt die fehlende Datenbasis, wenn es nicht bewertet werden konnte. */
  fehlendeBasis: string | null;
}

/** Verdichtete Terminhistorie aus zvg_auction_events. */
export interface Terminhistorie {
  /** Anzahl unterschiedlicher beobachteter Termine. */
  terminAnzahl: number;
  /** Verkehrswert der ersten Beobachtung. */
  verkehrswertErst: number | null;
  /** Verkehrswert der jüngsten Beobachtung. */
  verkehrswertAktuell: number | null;
}

/** Präsentationsqualität des Inserats — beeinflusst Bieterkonkurrenz, nicht den Wert. */
export interface Praesentation {
  bildAnzahl: number;
  beschreibungZeichen: number;
  hatExpose: boolean;
  /** Ersterfassung, für die Vorlaufzeit bis zum Termin. */
  erfasstAm: Date | null;
}

export interface ChanceInput {
  verkehrswert: number | null;
  terminDate: Date | null;
  preisProM2: number | null;
  /** Nur noch sekundäre Plausibilitätszahl, ohne Einfluss auf die Chance. */
  benchmark: PeerBenchmark | null;
  /** Angebotspreis-Niveau im Mikromarkt — Basis der Marktlücke. */
  marktreferenzKauf?: Marktreferenz | null;
  /** Angebotsmieten im Mikromarkt — Basis der Mietaussage. */
  marktreferenzMiete?: Marktreferenz | null;
  historie: Terminhistorie | null;
  praesentation: Praesentation | null;
  risiken: InvestorRiskAssessment;
  underwriting: InvestmentUnderwriting;
  profile: InvestorProfile;
  /** Zeitpunkt der KI-Analyse; fehlt sie, ist das Objekt nicht bewertbar. */
  analyzedAt: Date | null;
  needsReview: boolean;
  /**
   * Geringstes Gebot aus der Terminsbestimmung. In der Praxis fast immer null:
   * das Gericht stellt den Betrag erst im Termin fest.
   */
  geringstesGebotEur: number | null;
  /** Bestehenbleibende Rechte geprüft — dieselbe Quelle, dieselbe Lücke. */
  rechteVerifiziert: boolean;
  now?: Date;
}

export interface ChanceErgebnis {
  /** Der einzige sichtbare und sortierende Score, 0–100. */
  wert: number;
  /** Punktsumme vor Datenreife-Faktor und Sondersituations-Deckel. */
  rohwert: number;
  datenreife: Datenreife;
  datenreifeFaktor: number;
  konfidenz: Konfidenz;
  signale: SignalErgebnis[];
  sondersituation: boolean;
  /** Kurzbegründungen der Signale, die tatsächlich gefeuert haben. */
  begruendung: string[];
  /** Was fehlt, um mehr sagen zu können. */
  luecken: string[];
}

function tageBis(ziel: Date | null, now: Date): number | null {
  return calendarDaysUntil(ziel, now);
}

function istAelterAls(wert: Date | null, now: Date, tage: number): boolean {
  const age = calendarDaysUntil(wert, now);
  return age != null && -age > tage;
}

/**
 * Datenreife ersetzt das alte vierstufige Reifemodell. Der frühere
 * Readiness-Deckel von 80 gegen eine Schwelle von 85 machte die höchste Stufe
 * strukturell unerreichbar. Hier gibt es keinen Deckel: `verifiziert` hängt
 * ausschließlich daran, ob geringstes Gebot und bestehenbleibende Rechte
 * tatsächlich vorliegen.
 *
 * Beide Zahlen stehen nicht in den Veröffentlichungen: eine Auswertung aller
 * 467 hinterlegten Bekanntmachungen am 12.08.2026 ergab null Treffer, mehrere
 * Texte sagen ausdrücklich, das geringste Gebot werde erst im Termin bekannt
 * gegeben. `bewertbar` ist damit die höchste Stufe, die ohne Akteneinsicht oder
 * Rückfrage beim Gericht erreichbar ist.
 */
export function bestimmeDatenreife(input: ChanceInput): Datenreife {
  const now = input.now ?? new Date();
  if (
    input.needsReview ||
    input.verkehrswert == null ||
    input.verkehrswert < 1_000 ||
    input.analyzedAt == null ||
    istAelterAls(input.analyzedAt, now, ANALYSE_MAX_ALTER_TAGE)
  ) {
    return "unvollstaendig";
  }
  if (input.geringstesGebotEur != null && input.rechteVerifiziert) {
    return "verifiziert";
  }
  return "bewertbar";
}

function signalWiederholungstermin(input: ChanceInput): SignalErgebnis {
  const max = 25;
  if (!input.historie) {
    return {
      id: "wiederholungstermin",
      label: "Wiederholungstermin",
      punkte: 0,
      maxPunkte: max,
      begruendung: null,
      fehlendeBasis: "Keine Terminhistorie erfasst",
    };
  }
  if (input.historie.terminAnzahl < 2) {
    return {
      id: "wiederholungstermin",
      label: "Wiederholungstermin",
      punkte: 0,
      maxPunkte: max,
      begruendung: null,
      fehlendeBasis: null,
    };
  }
  // Ab dem zweiten Termin fallen die Wertgrenzen von 5/10 und 7/10. Jeder
  // weitere Termin verstärkt das, aber mit abnehmendem Zusatznutzen.
  const punkte = Math.min(max, 18 + (input.historie.terminAnzahl - 2) * 7);
  return {
    id: "wiederholungstermin",
    label: "Wiederholungstermin",
    punkte,
    maxPunkte: max,
    begruendung: `${input.historie.terminAnzahl}. Termin — die Wertgrenzen 5/10 und 7/10 greifen hier nicht mehr`,
    fehlendeBasis: null,
  };
}

function signalWertReduktion(input: ChanceInput): SignalErgebnis {
  const max = 15;
  const erst = input.historie?.verkehrswertErst ?? null;
  const aktuell = input.historie?.verkehrswertAktuell ?? null;
  if (erst == null || aktuell == null || erst <= 0) {
    return {
      id: "verkehrswert_reduktion",
      label: "Verkehrswert gesenkt",
      punkte: 0,
      maxPunkte: max,
      begruendung: null,
      fehlendeBasis: "Kein zweiter Verkehrswert beobachtet",
    };
  }
  const reduktionPct = (1 - aktuell / erst) * 100;
  if (reduktionPct <= 0) {
    return {
      id: "verkehrswert_reduktion",
      label: "Verkehrswert gesenkt",
      punkte: 0,
      maxPunkte: max,
      begruendung: null,
      fehlendeBasis: null,
    };
  }
  return {
    id: "verkehrswert_reduktion",
    label: "Verkehrswert gesenkt",
    punkte: Math.min(max, reduktionPct * 0.75),
    maxPunkte: max,
    begruendung: `Verkehrswert seit der ersten Beobachtung um ${reduktionPct.toFixed(0)} % gesenkt`,
    fehlendeBasis: null,
  };
}

/**
 * Marktlücke: Verkehrswert je Quadratmeter gegen das Angebotspreis-Niveau
 * derselben Kategorie im selben Mikromarkt.
 *
 * Löst die ZVG-Peer-Abweichung als Score-Treiber ab. Die verglich gerichtliche
 * Werte gegen gerichtliche Werte und maß damit die Streuung zwischen Gutachtern,
 * nicht den Abstand zum Markt. Der Peer-Median bleibt als sekundäre
 * Plausibilitätszahl erhalten, sichtbar beschriftet, aber ohne Punkte.
 */
function signalMarktluecke(input: ChanceInput): SignalErgebnis {
  const max = 25;
  const referenz = input.marktreferenzKauf ?? null;
  const luecke = berechneMarktluecke(input.preisProM2, referenz, input.now);
  if (luecke == null) {
    const fehlt =
      input.preisProM2 == null
        ? "Kein €/m² berechenbar — Wohnfläche fehlt"
        : referenz == null
          ? "Keine Vergleichsangebote im Mikromarkt"
          : `Stichprobe zu klein (n=${referenz.stichprobe}, nötig ${MARKTREFERENZ_MIN_STICHPROBE})`;
    return {
      id: "marktluecke",
      label: "Marktlücke",
      punkte: 0,
      maxPunkte: max,
      begruendung: null,
      fehlendeBasis: fehlt,
    };
  }
  if (luecke <= 0) {
    return {
      id: "marktluecke",
      label: "Marktlücke",
      punkte: 0,
      maxPunkte: max,
      begruendung: null,
      fehlendeBasis: null,
    };
  }
  return {
    id: "marktluecke",
    label: "Marktlücke",
    punkte: Math.min(max, luecke / 2),
    maxPunkte: max,
    begruendung: `${luecke.toFixed(0)} % unter dem Angebotspreis-Niveau im Mikromarkt ${referenz?.mikromarkt}x (n=${referenz?.stichprobe})`,
    fehlendeBasis: null,
  };
}

function signalWirtschaftlichkeit(input: ChanceInput): SignalErgebnis {
  const max = 25;
  const { profile, underwriting } = input;
  const baseHold = underwriting.buyHold.find((item) => item.name === "base");
  const bearHold = underwriting.buyHold.find((item) => item.name === "bear");
  const baseFlip = underwriting.fixFlip.find((item) => item.name === "base");
  const bearFlip = underwriting.fixFlip.find((item) => item.name === "bear");

  const kandidaten: { punkte: number; text: string }[] = [];

  if (
    profile.strategies.includes("buy_hold") &&
    baseHold?.cashOnCashPct != null &&
    bearHold != null &&
    baseHold.monthlyRentEur > 0
  ) {
    const zielErreicht = baseHold.cashOnCashPct / Math.max(0.1, profile.targetCashOnCashPct);
    const dscrOk = baseHold.dscr == null || baseHold.dscr >= profile.minDscr;
    const bearOk = bearHold.cashflowBeforeTaxEur >= 0;
    const eigenkapitalOk = baseHold.equityRequiredEur <= profile.maxEquityEur;
    if (dscrOk && bearOk && eigenkapitalOk && zielErreicht > 0) {
      kandidaten.push({
        punkte: Math.min(max, zielErreicht * max * 0.8),
        text: `${baseHold.cashOnCashPct.toFixed(1)} % Cash-on-Cash im Base Case, Bear Case bleibt cashflowpositiv`,
      });
    }
  }

  if (
    profile.strategies.includes("fix_flip") &&
    baseFlip != null &&
    bearFlip != null &&
    baseFlip.arvEur > 0
  ) {
    // renovationCapacity war bisher ein totes Profilfeld. Hier begrenzt es den
    // Sanierungsanteil an der Gesamtinvestition, den wir uns zutrauen.
    const sanierungsGrenze =
      profile.renovationCapacity === "low"
        ? 0.15
        : profile.renovationCapacity === "medium"
          ? 0.35
          : 1;
    const sanierungsAnteil =
      baseFlip.totalInvestmentEur > 0 ? baseFlip.renovationEur / baseFlip.totalInvestmentEur : 0;
    const kapazitaetOk = sanierungsAnteil <= sanierungsGrenze;
    const irrOk =
      baseFlip.annualizedRoiPct == null || baseFlip.annualizedRoiPct >= profile.targetIrrPct;
    const zielErreicht = baseFlip.marginOnCostPct / Math.max(1, profile.targetFlipMarginPct);
    if (
      kapazitaetOk &&
      irrOk &&
      bearFlip.profitEur >= 0 &&
      baseFlip.equityRequiredEur <= profile.maxEquityEur &&
      baseFlip.holdingMonths <= profile.maxHoldingMonths &&
      zielErreicht > 0
    ) {
      kandidaten.push({
        punkte: Math.min(max, zielErreicht * max * 0.8),
        text: `${baseFlip.marginOnCostPct.toFixed(0)} % Flip-Marge im Base Case, Bear Case ohne Verlust`,
      });
    }
  }

  if (kandidaten.length === 0) {
    const ohneMiete = baseHold == null || baseHold.monthlyRentEur <= 0;
    const ohneArv = baseFlip == null || baseFlip.arvEur <= 0;
    return {
      id: "wirtschaftlichkeit",
      label: "Wirtschaftlichkeit nach Profil",
      punkte: 0,
      maxPunkte: max,
      begruendung: null,
      fehlendeBasis:
        ohneMiete && ohneArv
          ? "Weder Mietbasis noch ARV vorhanden"
          : "Kein Szenario erfüllt die Profilziele",
    };
  }

  const beste = kandidaten.sort((a, b) => b.punkte - a.punkte)[0];
  return {
    id: "wirtschaftlichkeit",
    label: "Wirtschaftlichkeit nach Profil",
    punkte: beste.punkte,
    maxPunkte: max,
    begruendung: beste.text,
    fehlendeBasis: null,
  };
}

function signalSchwachePraesentation(input: ChanceInput): SignalErgebnis {
  const max = 10;
  if (!input.praesentation) {
    return {
      id: "schwache_praesentation",
      label: "Schwache Präsentation",
      punkte: 0,
      maxPunkte: max,
      begruendung: null,
      fehlendeBasis: "Präsentationsdaten nicht geladen",
    };
  }
  const maengel: string[] = [];
  if (input.praesentation.bildAnzahl === 0) maengel.push("keine Bilder");
  if (input.praesentation.beschreibungZeichen < BESCHREIBUNG_MIN_ZEICHEN) {
    maengel.push("sehr kurze Beschreibung");
  }
  if (!input.praesentation.hatExpose) maengel.push("kein Exposé");
  if (maengel.length === 0) {
    return {
      id: "schwache_praesentation",
      label: "Schwache Präsentation",
      punkte: 0,
      maxPunkte: max,
      begruendung: null,
      fehlendeBasis: null,
    };
  }
  return {
    id: "schwache_praesentation",
    label: "Schwache Präsentation",
    punkte: Math.min(max, maengel.length * 4),
    maxPunkte: max,
    begruendung: `${maengel.join(", ")} — senkt die Bieterkonkurrenz, nicht den Objektwert`,
    fehlendeBasis: null,
  };
}

function signalKurzeVorlaufzeit(input: ChanceInput): SignalErgebnis {
  const max = 10;
  const erfasstAm = input.praesentation?.erfasstAm ?? null;
  if (!erfasstAm || !input.terminDate) {
    return {
      id: "spaet_veroeffentlicht",
      label: "Spät veröffentlicht",
      punkte: 0,
      maxPunkte: max,
      begruendung: null,
      fehlendeBasis: "Termin oder Ersterfassung unbekannt",
    };
  }
  const vorlauf = tageBis(input.terminDate, erfasstAm);
  if (vorlauf == null || vorlauf >= KURZE_VORLAUFZEIT_TAGE || vorlauf < 0) {
    return {
      id: "spaet_veroeffentlicht",
      label: "Spät veröffentlicht",
      punkte: 0,
      maxPunkte: max,
      begruendung: null,
      fehlendeBasis: null,
    };
  }
  return {
    id: "spaet_veroeffentlicht",
    label: "Spät veröffentlicht",
    punkte: max,
    maxPunkte: max,
    begruendung: `Nur ${vorlauf} Tage zwischen Veröffentlichung und Termin — wenig Zeit für andere Interessenten`,
    fehlendeBasis: null,
  };
}

const SIGNAL_BERECHNUNGEN = [
  signalWiederholungstermin,
  signalWertReduktion,
  signalMarktluecke,
  signalWirtschaftlichkeit,
  signalSchwachePraesentation,
  signalKurzeVorlaufzeit,
] as const;

function bestimmeKonfidenz(
  input: ChanceInput,
  datenreife: Datenreife,
  signale: SignalErgebnis[],
): Konfidenz {
  if (datenreife === "unvollstaendig" || input.risiken.critical.length > 0) {
    return "keine";
  }
  const belegt = signale.filter((signal) => signal.fehlendeBasis === null).length;
  // Konfidenz hängt an der unabhängigen Marktreferenz, nicht mehr am
  // ZVG-Peer-Median: eine belastbare Peer-Gruppe belegt nur, dass mehrere
  // Gutachter ähnlich geschätzt haben.
  const marktBelastbar = istBelastbar(input.marktreferenzKauf, input.now);
  const ohneMaterielleRisiken = input.risiken.material.length === 0;

  if (datenreife === "verifiziert" && marktBelastbar && ohneMaterielleRisiken && belegt >= 5) {
    return "hoch";
  }
  if (belegt >= 4 && input.risiken.material.length <= 1) return "mittel";
  if (belegt >= 2) return "niedrig";
  return "keine";
}

export function berechneChance(input: ChanceInput): ChanceErgebnis {
  const signale = SIGNAL_BERECHNUNGEN.map((berechne) => berechne(input));
  const rohwert = signale.reduce((summe, signal) => summe + signal.punkte, 0);
  const datenreife = bestimmeDatenreife(input);
  const datenreifeFaktor = DATENREIFE_FAKTOR[datenreife];
  const sondersituation = input.risiken.critical.length > 0;

  let wert = rohwert * datenreifeFaktor;
  if (sondersituation) wert = Math.min(wert, SONDERSITUATION_DECKEL);
  wert = Math.max(0, Math.min(100, Math.round(wert)));

  const luecken = signale
    .filter((signal) => signal.fehlendeBasis != null)
    .map((signal) => `${signal.label}: ${signal.fehlendeBasis}`);

  return {
    wert,
    rohwert: Math.round(rohwert),
    datenreife,
    datenreifeFaktor,
    konfidenz: bestimmeKonfidenz(input, datenreife, signale),
    signale,
    sondersituation,
    begruendung: signale
      .filter((signal) => signal.punkte > 0 && signal.begruendung != null)
      .sort((a, b) => b.punkte - a.punkte)
      .map((signal) => signal.begruendung as string),
    luecken,
  };
}
