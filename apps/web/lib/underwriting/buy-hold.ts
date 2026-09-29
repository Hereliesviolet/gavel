/**
 * Buy & Hold – Finanzierung & Cashflow-Projektion (reine Rechenlogik, ohne
 * React/UI-Abhängigkeiten, damit sie unabhängig von der Darstellung
 * überprüfbar ist). Wird von BuyHoldCard (components/zvg/detail/ki-sections/
 * buy-hold.tsx) client-seitig aufgerufen, KEIN Server-Roundtrip.
 *
 * Bewusste Vereinfachungen (siehe Disclaimer in der UI):
 * - Nach Ende der Zinsbindung wird mit dem separat eingegebenen
 *   Anschlusszins und dem bisherigen Tilgungssatz eine neue Annuität auf
 *   die dann verbleibende Restschuld berechnet.
 * - AfA-Satz linear 2 % (§ 7 Abs. 4 Nr. 2 EStG, Gebäude nach 1925 - bei
 *   Baujahr < 1925 wären es 2,5 %, wird hier für v1 ignoriert).
 * - Gebäude-/Grundanteil pauschal 80/20 (keine Kaufpreisaufteilungs-
 *   Gutachten-Logik).
 * - Bewirtschaftungskosten (Hausgeld-Anteil + Verwaltung) werden NICHT mit
 *   der Mietsteigerung skaliert - konservative, vereinfachte Annahme.
 */

export interface BuyHoldInputs {
  kaufpreisEur: number;
  erwerbsnebenkostenEur: number;
  eigenkapitalEur: number;
  zinssatzPct: number;
  tilgungssatzPct: number;
  zinsbindungJahre: number;
  anschlusszinssatzPct: number;
  kaltmieteMonatlich: number;
  mietsteigerungPct: number;
  nichtUmlagefaehigeKostenMonatlich: number;
  verwaltungMonatlich: number;
  mietausfallwagnisPct: number;
  grenzsteuersatzPct: number;
  projektionsjahre: number;
  /**
   * Steuer und AfA sind ein optionaler Block: sie hängen an der persönlichen
   * Situation und gehören nicht in eine Objektbewertung, die ohne sie
   * vergleichbar bleiben muss.
   */
  steuerBeruecksichtigen?: boolean;
}

export interface BuyHoldJahresErgebnis {
  jahr: number;
  miete: number;
  zinsanteil: number;
  tilgungsanteil: number;
  restschuldEnde: number;
  bewirtschaftungskosten: number;
  afa: number;
  steuerlichesErgebnis: number;
  steuereffekt: number;
  cashflowVorSteuer: number;
  cashflowNachSteuer: number;
}

export interface BuyHoldErgebnis {
  darlehenssummeEur: number;
  monatlicheRateEur: number;
  anschlussMonatlicheRateEur: number | null;
  gebaeudeanteilEur: number;
  afaJahrEur: number;
  jahre: BuyHoldJahresErgebnis[];
  breakEvenJahrVorSteuer: number | null;
  breakEvenJahrNachSteuer: number | null;
}

const GEBAEUDEANTEIL_PCT = 0.8;
const AFA_SATZ_PCT = 2;

export function berechneBuyHoldProjektion(inputs: BuyHoldInputs): BuyHoldErgebnis {
  const {
    kaufpreisEur,
    erwerbsnebenkostenEur,
    eigenkapitalEur,
    zinssatzPct,
    tilgungssatzPct,
    zinsbindungJahre,
    anschlusszinssatzPct,
    kaltmieteMonatlich,
    mietsteigerungPct,
    nichtUmlagefaehigeKostenMonatlich,
    verwaltungMonatlich,
    mietausfallwagnisPct,
    grenzsteuersatzPct,
    projektionsjahre,
    steuerBeruecksichtigen = true,
  } = inputs;

  const darlehenssummeEur = Math.max(0, kaufpreisEur + erwerbsnebenkostenEur - eigenkapitalEur);
  const monatlicheRateEur = (darlehenssummeEur * (zinssatzPct + tilgungssatzPct)) / 100 / 12;
  const gebaeudeanteilEur = kaufpreisEur * GEBAEUDEANTEIL_PCT;
  const afaJahrEur = (gebaeudeanteilEur * AFA_SATZ_PCT) / 100;

  let restschuld = darlehenssummeEur;
  let anschlussMonatlicheRateEur: number | null = null;
  const jahre: BuyHoldJahresErgebnis[] = [];

  for (let t = 0; t < projektionsjahre; t++) {
    const miete = kaltmieteMonatlich * Math.pow(1 + mietsteigerungPct / 100, t) * 12;

    let zinsanteilJahr = 0;
    let tilgungsanteilJahr = 0;
    for (let m = 0; m < 12; m++) {
      const absoluterMonat = t * 12 + m;
      const nachZinsbindung = absoluterMonat >= Math.max(0, zinsbindungJahre) * 12;
      if (nachZinsbindung && anschlussMonatlicheRateEur == null) {
        anschlussMonatlicheRateEur =
          (restschuld * (anschlusszinssatzPct + tilgungssatzPct)) / 100 / 12;
      }
      const aktuellerZins = nachZinsbindung ? anschlusszinssatzPct : zinssatzPct;
      const aktuelleRate = nachZinsbindung
        ? (anschlussMonatlicheRateEur ?? monatlicheRateEur)
        : monatlicheRateEur;
      const zinsMonat = (restschuld * aktuellerZins) / 100 / 12;
      const tilgungMonat = Math.min(Math.max(aktuelleRate - zinsMonat, 0), restschuld);
      restschuld -= tilgungMonat;
      zinsanteilJahr += zinsMonat;
      tilgungsanteilJahr += tilgungMonat;
    }

    const bewirtschaftungskosten =
      (nichtUmlagefaehigeKostenMonatlich + verwaltungMonatlich) * 12 +
      (miete * mietausfallwagnisPct) / 100;

    const steuerlichesErgebnis = miete - zinsanteilJahr - bewirtschaftungskosten - afaJahrEur;
    const steuereffekt = steuerBeruecksichtigen
      ? (-steuerlichesErgebnis * grenzsteuersatzPct) / 100
      : 0;

    const cashflowVorSteuer =
      miete - (zinsanteilJahr + tilgungsanteilJahr) - bewirtschaftungskosten;
    const cashflowNachSteuer = cashflowVorSteuer + steuereffekt;

    jahre.push({
      jahr: t,
      miete,
      zinsanteil: zinsanteilJahr,
      tilgungsanteil: tilgungsanteilJahr,
      restschuldEnde: restschuld,
      bewirtschaftungskosten,
      afa: afaJahrEur,
      steuerlichesErgebnis,
      steuereffekt,
      cashflowVorSteuer,
      cashflowNachSteuer,
    });
  }

  const breakEvenVorSteuer = jahre.find((j) => j.cashflowVorSteuer > 0);
  const breakEvenNachSteuer = jahre.find((j) => j.cashflowNachSteuer > 0);

  return {
    darlehenssummeEur,
    monatlicheRateEur,
    anschlussMonatlicheRateEur,
    gebaeudeanteilEur,
    afaJahrEur,
    jahre,
    breakEvenJahrVorSteuer: breakEvenVorSteuer ? breakEvenVorSteuer.jahr : null,
    breakEvenJahrNachSteuer: breakEvenNachSteuer ? breakEvenNachSteuer.jahr : null,
  };
}
