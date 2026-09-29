/**
 * Die einzige Stelle, an der in Gavel Geld gerechnet wird.
 *
 * `engine` liefert Bear/Base/Bull und das Maximalgebot, `flip` die
 * Anzeigekennzahlen für Fix & Flip, `buy-hold` die mehrjährige Projektion des
 * Szenario-Editors, `kaufpreis` die beschriftete Kaufpreisannahme, an der alle
 * drei hängen.
 */

export * from "./engine";
export * from "./flip";
export * from "./buy-hold";
export * from "./kaufpreis";
