import {
  pgTable,
  pgView,
  uuid,
  text,
  integer,
  boolean,
  numeric,
  timestamp,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { realEstateListings } from "./immobilien";

/**
 * Vergleichsangebote von IS24, Immowelt und Kleinanzeigen.
 *
 * BEWUSST getrennt von `real_estate_listings`: dort stehen Objekte, die ein
 * Nutzer selbst eingereicht hat, also eine selektionsverzerrte Stichprobe von
 * "Objekten, die wir zufällig angeschaut haben". Vergleichswerte brauchen
 * systematische, periodisch erneuerte Abdeckung je Mikromarkt ohne Nutzerbezug.
 *
 * Angebotspreise liegen systematisch über realisierten Preisen. Deshalb heißt
 * die abgeleitete Größe überall "Angebotspreis-Niveau", nie "Marktwert" — es
 * gibt keinen Korrekturfaktor, den wir belegen könnten.
 */
export const marketComparables = pgTable(
  "market_comparables",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    quelle: text("quelle").notNull(),
    externeId: text("externe_id").notNull(),
    url: text("url").notNull(),
    angebotstyp: text("angebotstyp").notNull(), // 'kauf' | 'miete'
    kategorie: text("kategorie").notNull(), // 'haus' | 'wohnung'
    titel: text("titel"),
    plz: text("plz").notNull(),
    /** Dreistelliges PLZ-Präfix als Näherung an den Kreis, siehe Migration 0021. */
    mikromarkt: text("mikromarkt").notNull(),
    ort: text("ort"),
    wohnflaecheM2: numeric("wohnflaeche_m2", { precision: 10, scale: 2 }),
    zimmer: numeric("zimmer", { precision: 4, scale: 1 }),
    preisEur: integer("preis_eur"),
    preisProM2: numeric("preis_pro_m2", { precision: 10, scale: 2 }),
    kandidatStatus: text("kandidat_status").notNull().default("offen"),
    kandidatGrund: text("kandidat_grund"),
    befoerdertAm: timestamp("befoerdert_am", { withTimezone: true }),
    erfasstAm: timestamp("erfasst_am", { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
    zuletztGesehenAm: timestamp("zuletzt_gesehen_am", { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
    istAktiv: boolean("ist_aktiv").notNull().default(true),
  },
  (t) => [
    unique("market_comparables_quelle_externe_id_unique").on(t.quelle, t.externeId),
    index("idx_market_comparables_markt").on(t.mikromarkt, t.kategorie, t.angebotstyp),
    index("idx_market_comparables_kandidat").on(t.kandidatStatus, t.erfasstAm),
  ],
);

/**
 * Preis- und Standzeitbeobachtung. Zeigt Verhandlungsspielraum an und
 * kalibriert die Preislücken-Schwelle, ohne dass wir dafür bieten müssen:
 * verschwindet eine Anzeige nach einer Senkung, war der Preis vorher zu hoch.
 */
export const marketListingEvents = pgTable(
  "market_listing_events",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    listingId: uuid("listing_id").references(() => realEstateListings.id, {
      onDelete: "cascade",
    }),
    comparableId: uuid("comparable_id").references(() => marketComparables.id, {
      onDelete: "cascade",
    }),
    preisEur: integer("preis_eur"),
    status: text("status").notNull().default("online"),
    beobachtetAm: timestamp("beobachtet_am", { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
  },
  (t) => [
    index("idx_market_listing_events_listing").on(t.listingId, t.beobachtetAm),
    index("idx_market_listing_events_comparable").on(t.comparableId, t.beobachtetAm),
  ],
);

/** Angebotspreis-Niveau je Mikromarkt, Kategorie und Angebotstyp (View, siehe 0021/0039). */
export const marketReference = pgView("market_reference", {
  mikromarkt: text("mikromarkt").notNull(),
  kategorie: text("kategorie").notNull(),
  angebotstyp: text("angebotstyp").notNull(),
  stichprobe: integer("stichprobe").notNull(),
  medianEurM2: numeric("median_eur_m2", { precision: 10, scale: 2 }),
  p25EurM2: numeric("p25_eur_m2", { precision: 10, scale: 2 }),
  p75EurM2: numeric("p75_eur_m2", { precision: 10, scale: 2 }),
  stand: timestamp("stand", { withTimezone: true }),
}).existing();
