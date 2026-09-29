import {
  pgTable,
  uuid,
  text,
  integer,
  smallint,
  boolean,
  decimal,
  timestamp,
  jsonb,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

export const realEstateListings = pgTable(
  "real_estate_listings",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    externalId: text("external_id").notNull(),
    source: text("source").notNull(), // 'immoscout24'|'ebay-kleinanzeigen'|'custom'
    sourceUrl: text("source_url").notNull(),

    typ: text("typ"),
    angebotstyp: text("angebotstyp"), // 'miete'|'kauf'
    titel: text("titel"),
    adresse: text("adresse"),
    plz: text("plz"),
    ort: text("ort"),
    lat: decimal("lat", { precision: 10, scale: 7 }),
    lng: decimal("lng", { precision: 10, scale: 7 }),

    preis: integer("preis"),
    preisProM2: decimal("preis_pro_m2", { precision: 10, scale: 2 }),
    wohnflaecheM2: decimal("wohnflaeche_m2", { precision: 10, scale: 2 }),
    grundstuecksflaecheM2: decimal("grundstuecksflaeche_m2", { precision: 10, scale: 2 }),
    nutzflaecheM2: decimal("nutzflaeche_m2", { precision: 10, scale: 2 }),
    zimmer: decimal("zimmer", { precision: 4, scale: 1 }),
    etage: text("etage"),
    anzahlEtagen: smallint("anzahl_etagen"),
    baujahr: smallint("baujahr"),
    effizienzklasse: text("effizienzklasse"),
    energieausweisTyp: text("energieausweis_typ"),
    endenergiebedarfKwh: decimal("endenergiebedarf_kwh", { precision: 8, scale: 2 }),
    heizung: text("heizung"),
    denkmalschutz: boolean("denkmalschutz"),
    vermietet: boolean("vermietet"),
    hausgeldEur: decimal("hausgeld_eur", { precision: 10, scale: 2 }),
    kaltmieteEur: decimal("kaltmiete_eur", { precision: 10, scale: 2 }),
    zustandKurz: text("zustand_kurz"),
    coverImageUrl: text("cover_image_url"),

    istAktiv: boolean("ist_aktiv").default(true),
    rawData: jsonb("raw_data"),
    scrapedAt: timestamp("scraped_at").default(sql`NOW()`),
    firstSeenAt: timestamp("first_seen_at").default(sql`NOW()`),
    lastSeenAt: timestamp("last_seen_at").default(sql`NOW()`),

    // Custom-URL-Analyse-Feature (Baustein 3, siehe docs/CUSTOM_URL_ANALYSIS.md
    // + drizzle/migrations/0007_real_estate_custom_url.sql). NULL für die
    // bisher nur als Schema vorbereiteten, noch nicht befüllten Zeilen
    // (Portal-Scraping ohne Nutzerbezug); gesetzt, wenn ein Listing über die
    // Custom-URL-Analyse (POST /internal/analyze-url) von einem eingeloggten
    // Nutzer eingereicht wurde. Dient der Verlaufsansicht ("meine bisherigen
    // Analysen") in apps/web/app/analyse/(uebersicht)/page.tsx.
    submittedByUserId: uuid("submitted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => ({
    uniqueExternalSource: unique().on(t.externalId, t.source),
  }),
);

// Custom-URL-Analyse: eigenständige KI-Analyse-Struktur für frei eingereichte
// Markt-Exposés (ImmoScout24, eBay Kleinanzeigen, Immowelt, ...) - BEWUSST
// NICHT zvg_ki_analyses/KIAnalyseResult zweckentfremdet (andere Domäne: dort
// geht es um Gutachten-Extraktion für Zwangsversteigerungen, hier um
// Markt-Fairness-Bewertung eines freiwillig inserierten Angebots).
export const realEstateKiAnalyses = pgTable("real_estate_ki_analyses", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  listingId: uuid("listing_id")
    .notNull()
    .references(() => realEstateListings.id, { onDelete: "cascade" }),

  preisBewertung: text("preis_bewertung"), // 'günstig'|'marktüblich'|'teuer'|'unbekannt'
  // positiv = teurer als Marktdurchschnitt (KI), negativ = günstiger
  preisAbweichungPct: decimal("preis_abweichung_pct", { precision: 6, scale: 2 }),
  staerken: jsonb("staerken").default(sql`'[]'::jsonb`),
  schwaechen: jsonb("schwaechen").default(sql`'[]'::jsonb`),
  lageBewertung: text("lage_bewertung"),
  renditeGeschaetztPct: decimal("rendite_geschaetzt_pct", { precision: 6, scale: 2 }),
  zusammenfassung: text("zusammenfassung"),

  // Investoren-Einschätzung (2026-07-08, siehe drizzle/migrations/0010_*.sql +
  // scrapers/src/models/real_estate.py CustomMarketAnalyse) - BEWUSST getrennt
  // von der bereits bestehenden Markt-Fairness-Bewertung oben: staerken/
  // schwaechen bewerten Fairness ggü. dem Markt, risikenInvestor bewertet
  // dagegen konkrete Investitionsrisiken (Sanierungsstau, Vermietbarkeit,
  // Lagerisiko, Klumpenrisiko).
  investmentScore: text("investment_score"), // 'attraktiv'|'neutral'|'abraten'
  investmentScoreBegruendung: text("investment_score_begruendung"),
  risikenInvestor: jsonb("risiken_investor").default(sql`'[]'::jsonb`),
  cashflowEinschaetzung: text("cashflow_einschaetzung"),

  // Fix & Flip (2026-07-08, siehe drizzle/migrations/0011_*.sql +
  // scrapers/src/models/real_estate.py CustomMarketAnalyse) - BEWUSST
  // identische Spaltennamen wie in zvg.ts::zvgKiAnalyses (Voraussetzung für
  // die gemeinsame Frontend-Komponente InvestmentFixFlipSection). Anders als
  // bei ZVG-Gutachten bleibt die Liste hier meist leer, da Custom-Listings
  // kein strukturiertes Gutachten haben (siehe Prompt in src/api/app.py).
  fixFlipMassnahmen: jsonb("fix_flip_massnahmen").default(sql`'[]'::jsonb`), // [{beschreibung, kategorie, kosten_min_eur, kosten_max_eur, prioritaet}]
  fixFlipWerteinschaetzung: text("fix_flip_werteinschaetzung"),
  fixFlipGesamtkostenMinEur: integer("fix_flip_gesamtkosten_min_eur"),
  fixFlipGesamtkostenMaxEur: integer("fix_flip_gesamtkosten_max_eur"),

  // Fix & Flip: nur die geschaetzten Eingangsgroessen, identisch benannt zu
  // zvg.ts::zvgKiAnalyses (gemeinsame Komponente InvestmentFixFlipSection).
  // Gewinn, ROI und Marge lagen bis 0023 als Spalten daneben und wurden im
  // Scraper anders gerechnet als im Web; sie kommen jetzt aus
  // apps/web/lib/underwriting.
  arvMinEur: integer("arv_min_eur"),
  arvMaxEur: integer("arv_max_eur"),
  arvBegruendung: text("arv_begruendung"),
  arvKonfidenz: text("arv_konfidenz"), // 'hoch'|'mittel'|'niedrig'
  holdingMonate: smallint("holding_monate").default(9),

  // ZVG-Parität (Custom-URL, siehe docs/CUSTOM_URL_ANALYSIS.md + Migration 0014).
  // Spaltennamen bewusst an zvg_ki_analyses angelehnt für Komponenten-Reuse.
  maengel: jsonb("maengel").default(sql`'[]'::jsonb`),
  modernisierungen: jsonb("modernisierungen").default(sql`'[]'::jsonb`),
  energieausweisVorhanden: boolean("energieausweis_vorhanden"),
  effizienzklasse: text("effizienzklasse"),
  ausweisjahr: smallint("ausweisjahr"),
  energietraeger: text("energietraeger"),
  endenergieverbrauchKwh: decimal("endenergieverbrauch_kwh", { precision: 8, scale: 2 }),
  innenbesichtigung: boolean("innenbesichtigung"),
  restnutzungsdauerJ: smallint("restnutzungsdauer_j"),
  heizung: text("heizung"),
  wohnraeume: text("wohnraeume"),
  zustandAussen: text("zustand_aussen"),
  zustandInnen: text("zustand_innen"),
  maengelKurz: text("maengel_kurz"),
  baubeschreibung: text("baubeschreibung"),
  instandhaltung: text("instandhaltung"),
  lageEinwohner: integer("lage_einwohner"),
  lageRegion: text("lage_region"),
  lageVerkehr: text("lage_verkehr"),
  lageCharakter: text("lage_charakter"),
  lageUmgebung: text("lage_umgebung"),
  moeglicherKaltmiete: decimal("moegliche_kaltmiete", { precision: 10, scale: 2 }),
  hausgeld: decimal("hausgeld", { precision: 10, scale: 2 }),
  jahresrohertrag: decimal("jahresrohertrag", { precision: 12, scale: 2 }),
  liegenschaftszinssatz: decimal("liegenschaftszinssatz", { precision: 6, scale: 2 }),
  ertragswert: decimal("ertragswert", { precision: 12, scale: 2 }),
  bodenrichtwertEurM2: decimal("bodenrichtwert_eur_m2", { precision: 10, scale: 2 }),
  bodenrichtwertStichtag: text("bodenrichtwert_stichtag"),
  bodenrichtwertBerechnung: text("bodenrichtwert_berechnung"),
  orteInDerNaehe: jsonb("orte_in_der_naehe").default(sql`'[]'::jsonb`),

  modelUsed: text("model_used"),
  tokensUsed: integer("tokens_used").default(0),
  analyzedAt: timestamp("analyzed_at", { withTimezone: true }).default(sql`NOW()`),
});

// Bild-Pipeline für die Custom-URL-Analyse (2026-07-08, Pendant zu zvgImages
// in drizzle/schema/zvg.ts) - lädt die von der KI erkannten Bild-URLs
// (CustomListingExtraction.bilder) dauerhaft nach MinIO hoch, statt die
// externen Quell-URLs direkt zu verlinken (Hotlinking auf Fremdportale ist
// unzuverlässig/CORS-anfällig). Siehe scrapers/src/storage/minio.py
// (upload_image) + scrapers/src/storage/real_estate.py
// (insert_real_estate_images).
export const realEstateImages = pgTable(
  "real_estate_images",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => realEstateListings.id, { onDelete: "cascade" }),
    storagePath: text("storage_path").notNull(),
    publicUrl: text("public_url"),
    position: smallint("position"),
    createdAt: timestamp("created_at").default(sql`NOW()`),
  },
  (t) => ({
    idxListingId: index("idx_real_estate_images_listing_id").on(t.listingId),
  }),
);

// Audit-Log + Async-Job für Custom-URL-Analyse. status: queued|running|success|error
export const customUrlRequests = pgTable(
  "custom_url_requests",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    status: text("status").notNull(),
    errorMessage: text("error_message"),
    listingId: uuid("listing_id").references(() => realEstateListings.id, {
      onDelete: "set null",
    }),
    step: text("step"),
    progressPct: integer("progress_pct"),
    stepDetail: text("step_detail"),
    stepLog: jsonb("step_log")
      .notNull()
      .default(sql`'[]'::jsonb`),
    preview: jsonb("preview"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).default(sql`NOW()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`NOW()`),
  },
  (t) => [index("idx_custom_url_requests_user_status").on(t.userId, t.status)],
);
