/**
 * Der vom Nutzer gesetzte Pipeline-Status. Bewusst getrennt von der
 * Datenreife: die sagt, wie belastbar unsere Zahlen sind, dieser Status sagt,
 * wie weit der Nutzer mit dem Objekt ist. Vorher wurde die algorithmische
 * Stufe wie ein CRM-Status inszeniert, ohne dass man sie bewegen konnte.
 *
 * Liegt bewusst ohne Datenbankzugriff in einer eigenen Datei, damit die
 * Desk-Oberfläche die Labels importieren kann, ohne den Postgres-Client in
 * das Client-Bundle zu ziehen.
 */
export const DESK_STATUS = [
  "watching",
  "examining",
  "bid",
  "acquired",
  "rejected",
  "sold",
] as const;

export type DeskStatus = (typeof DESK_STATUS)[number];

export const DESK_STATUS_LABEL: Record<DeskStatus, string> = {
  watching: "Beobachten",
  examining: "Prüfen",
  bid: "Geboten",
  acquired: "Gekauft",
  rejected: "Verworfen",
  sold: "Verkauft",
};

/** Spalten des Desks. Abgeschlossenes landet gesammelt in einer Spalte. */
export const DESK_SPALTEN: { status: DeskStatus; enthaelt: DeskStatus[] }[] = [
  { status: "watching", enthaelt: ["watching"] },
  { status: "examining", enthaelt: ["examining"] },
  { status: "bid", enthaelt: ["bid"] },
  { status: "acquired", enthaelt: ["acquired", "sold", "rejected"] },
];

export const DESK_SPALTEN_TITEL: Record<string, string> = {
  watching: "Beobachten",
  examining: "Prüfen",
  bid: "Geboten",
  acquired: "Abgeschlossen",
};
