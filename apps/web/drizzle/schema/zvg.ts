import {
  pgTable,
  uuid,
  text,
  integer,
  smallint,
  boolean,
  decimal,
  timestamp,
  date,
  jsonb,
  index,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

export const zvgListings = pgTable(
  "zvg_listings",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    aktenzeichen: text("aktenzeichen").notNull(),
    bundesland: text("bundesland").notNull(),
    bundeslandName: text("bundesland_name").notNull(),
    slug: text("slug").notNull(),
    source: text("source").notNull(), // 'justizportal'|'zvg.com'|'hanmark.de'
    sourceUrl: text("source_url"),
    direktlink: text("direktlink"),

    // Objekttyp
    typ: text("typ"),
    kategorie: text("kategorie"), // 'wohnung'|'haus'|'grundstueck'|'gewerbe'

    // Adresse
    adresse: text("adresse"),
    strasse: text("strasse"),
    hausnummer: text("hausnummer"),
    plz: text("plz"),
    ort: text("ort"),
    stadtteil: text("stadtteil"),
    lat: decimal("lat", { precision: 10, scale: 7 }),
    lng: decimal("lng", { precision: 10, scale: 7 }),

    // Werte
    verkehrswert: decimal("verkehrswert", { precision: 14, scale: 0 }),

    // Flächen
    wohnflaecheM2: decimal("wohnflaeche_m2", { precision: 10, scale: 2 }),
    grundstuecksflaecheM2: decimal("grundstuecksflaeche_m2", { precision: 10, scale: 2 }),
    nutzflaecheM2: decimal("nutzflaeche_m2", { precision: 10, scale: 2 }),
    gesamtflaecheM2: decimal("gesamtflaeche_m2", { precision: 10, scale: 2 }),

    // Gebäude
    baujahr: smallint("baujahr"),
    zimmer: decimal("zimmer", { precision: 4, scale: 1 }),
    etage: smallint("etage"),

    // Gerichtsdaten
    amtsgericht: text("amtsgericht"),
    versteigerungsort: text("versteigerungsort"),
    terminDate: timestamp("termin_date", { withTimezone: true }),
    terminSaal: text("termin_saal"),

    // Flags
    istNeu: boolean("ist_neu").default(false),
    istAktiv: boolean("ist_aktiv").default(true),
    denkmalschutz: boolean("denkmalschutz"),
    vermietet: boolean("vermietet"),

    // Texte
    beschreibung: text("beschreibung"),
    miteigentumsanteil: text("miteigentumsanteil"),
    sondereigentum: text("sondereigentum"),

    // Dokumente
    gutachtenUrl: text("gutachten_url"),
    exposeUrl: text("expose_url"),

    rawData: jsonb("raw_data"),
    scrapedAt: timestamp("scraped_at").default(sql`NOW()`),
    createdAt: timestamp("created_at").default(sql`NOW()`),
    updatedAt: timestamp("updated_at").default(sql`NOW()`),

    // "Verschwunden"-Erkennung (2026-07-04): wird bei jedem erfolgreichen
    // Scrape-Durchlauf, der dieses Listing in den aktuellen Ergebnissen der
    // Quelle findet, auf NOW() gesetzt (siehe upsert_zvg_listing in
    // scrapers/src/storage/postgres.py). Taucht ein aktives Listing mehrere
    // Tage in Folge nicht mehr auf (last_seen_at wird nicht aktualisiert),
    // archiviert es der konsolidierte Archivierungs-Mechanismus
    // (scrapers/src/flows/archive_past_listings.py) automatisch – zusätzlich
    // zum bestehenden Kriterium "termin_date in der Vergangenheit". Default
    // NOW() sorgt dafür, dass bestehende Zeilen beim Anlegen der Spalte einen
    // aktuellen Zeitstempel erhalten (kein sofortiges Fehl-Archivieren).
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).default(sql`NOW()`),

    // Proaktive Datenqualitäts-Validierungsschicht (2026-07-04, siehe
    // drizzle/migrations/0005_data_quality_flags.sql + docs/DATA_QUALITY.md).
    // dataQualityFlags: Array von {field, reason, message, severity, value,
    // expected, rules_version} - eine Zeile pro erkannter Auffälligkeit,
    // geschrieben von scrapers/src/flows/data_quality.py. needsReview ist
    // true, sobald mind. ein Flag severity in {warning,critical} hat.
    dataQualityFlags: jsonb("data_quality_flags")
      .default(sql`'[]'::jsonb`)
      .notNull(),
    needsReview: boolean("needs_review").default(false).notNull(),
    dataQualityCheckedAt: timestamp("data_quality_checked_at", { withTimezone: true }),

    // Vollständigkeits-Gate für die KI-Analyse (Baustein 2 der
    // Firecrawl-Migration, siehe drizzle/migrations/0006_scrape_completed_at.sql
    // + docs/CUSTOM_URL_ANALYSIS.md). Wird erst am ENDE der
    // Detail-Anreicherung eines Listings gesetzt (nach Bild-/Dokument-
    // Download in allen drei Scrapern) - bewusst NICHT bei der reinen
    // Listenübersicht, im Unterschied zu last_seen_at (das bei jedem Sichten
    // gesetzt wird, auch ohne Detail-Fetch). get_listings_without_ki()
    // (scrapers/src/flows/ki_analysis.py) verlangt NOT NULL hier, damit die
    // KI-Analyse nachweislich erst nach vollständigem Scraping startet.
    scrapeCompletedAt: timestamp("scrape_completed_at", { withTimezone: true }),
  },
  (t) => ({
    // Objektidentitaet, siehe drizzle/migrations/0020_zvg_identity_auction_events.sql.
    // Live als UNIQUE INDEX ueber (bundesland, COALESCE(amtsgericht,''),
    // aktenzeichen) angelegt - der COALESCE-Ausdruck laesst sich in Drizzle
    // nicht als unique() abbilden, deshalb hier nur zur Dokumentation.
    uniqueIdentitaet: index("uq_zvg_listings_identitaet").on(
      t.bundesland,
      t.amtsgericht,
      t.aktenzeichen,
    ),
    idxBundesland: index("idx_zvg_bundesland").on(t.bundesland),
    idxTermin: index("idx_zvg_termin").on(t.terminDate),
    idxLastSeenAt: index("idx_zvg_last_seen_at").on(t.lastSeenAt),
    idxScrapeCompletedAt: index("idx_zvg_scrape_completed_at").on(t.scrapeCompletedAt),
    idxVerkehrswert: index("idx_zvg_verkehrswert").on(t.verkehrswert),
    idxKategorie: index("idx_zvg_kategorie").on(t.kategorie),
    idxSlug: index("idx_zvg_slug").on(t.slug),
    uniqueBundeslandSlug: unique("zvg_listings_bundesland_slug_unique").on(t.bundesland, t.slug),
    idxGeo: index("idx_zvg_geo").on(t.lat, t.lng),
    // Live als partieller Index (WHERE needs_review = TRUE) angelegt (siehe
    // Migration) - hier zur Dokumentation als normaler Index abgebildet,
    // drizzle-kit erzeugt WHERE-Klauseln nicht automatisch nach.
    idxNeedsReview: index("idx_zvg_needs_review").on(t.needsReview),
    // app/api/search-suggestions
    // nutzt ILIKE '%term%' auf ort/adresse, was normale B-Tree-Indizes nicht
    // beschleunigen kann. GIN-Trigram-Indizes (pg_trgm-Extension) machen auch
    // "contains"-Suchen indexierbar. Live per CREATE INDEX CONCURRENTLY
    // angelegt (siehe drizzle/migrations/0003_user_alerts_user_id_idx.sql),
    // hier nur zur Dokumentation im Schema nachgezogen.
    idxOrtTrgm: index("idx_zvg_ort_trgm").using("gin", sql`${t.ort} gin_trgm_ops`),
    idxAdresseTrgm: index("idx_zvg_adresse_trgm").using("gin", sql`${t.adresse} gin_trgm_ops`),
  }),
);

export const zvgKiAnalyses = pgTable(
  "zvg_ki_analyses",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    listingId: uuid("listing_id").references(() => zvgListings.id, { onDelete: "cascade" }),

    // Grundbuch
    grundbuchBlatt: text("grundbuch_blatt"),
    grundbuchFlurstueck: text("grundbuch_flurstueck"),
    grundbuchGemarkung: text("grundbuch_gemarkung"),

    // Strukturierte Daten
    flurstuecke: jsonb("flurstuecke"), // [{nummer, grundbuch, blatt, gemarkung, wirtschaftsart}]
    maengel: jsonb("maengel"), // [{nummer, schweregrad, beschreibung}]
    belastungen: jsonb("belastungen"), // [{nummer, abteilung, beschreibung}]
    modernisierungen: jsonb("modernisierungen"), // [{jahr, beschreibung}]
    gebaeudenutzungen: jsonb("gebaeudenutzungen"),
    orteInDerNaehe: jsonb("orte_in_der_naehe"),

    // Bodenrichtwert
    bodenrichtwertEurM2: decimal("bodenrichtwert_eur_m2", { precision: 12, scale: 2 }),
    bodenrichtwertStichtag: date("bodenrichtwert_stichtag"),
    bodenrichtwertBerechnung: text("bodenrichtwert_berechnung"),

    // Energieausweis
    energieausweisVorhanden: boolean("energieausweis_vorhanden"),
    effizienzklasse: text("effizienzklasse"),
    ausweisjahr: smallint("ausweisjahr"),
    energietraeger: text("energietraeger"),
    endenergieverbrauchKwh: decimal("endenergieverbrauch_kwh", { precision: 8, scale: 2 }),

    // Objektzustand
    innenbesichtigung: boolean("innenbesichtigung"),
    restnutzungsdauerJ: smallint("restnutzungsdauer_j"),
    heizung: text("heizung"),
    wohnraeume: text("wohnraeume"),
    zustandAussen: text("zustand_aussen"),
    zustandInnen: text("zustand_innen"),
    maengelKurz: text("maengel_kurz"),

    // Bau & Instandhaltung
    baubeschreibung: text("baubeschreibung"),
    instandhaltung: text("instandhaltung"),
    baulasten: text("baulasten"),

    // Lage
    lageEinwohner: integer("lage_einwohner"),
    lageRegion: text("lage_region"),
    lageVerkehr: text("lage_verkehr"),
    lageCharakter: text("lage_charakter"),
    lageUmgebung: text("lage_umgebung"),

    // Ertragswert
    moeglicherKaltmiete: decimal("moegliche_kaltmiete", { precision: 10, scale: 2 }),
    hausgeld: decimal("hausgeld", { precision: 10, scale: 2 }),
    jahresrohertrag: decimal("jahresrohertrag", { precision: 12, scale: 2 }),
    liegenschaftszinssatz: decimal("liegenschaftszinssatz", { precision: 5, scale: 3 }),
    ertragswert: integer("ertragswert"),

    // Investoren-Analyse + Fix&Flip (2026-07-08, siehe drizzle/migrations/0011_*.sql
    // + scrapers/src/models/zvg.py KIAnalyseResult) - BEWUSST identische
    // Spaltennamen wie in immobilien.ts::realEstateKiAnalyses (Voraussetzung
    // für die gemeinsame Frontend-Komponente InvestmentFixFlipSection),
    // Tabellen/Modelle selbst aber getrennt gehalten (gleiche Domain-Trennung
    // wie bei maengel/flurstuecke oben).
    investmentScore: text("investment_score"), // 'attraktiv'|'neutral'|'abraten'
    investmentScoreBegruendung: text("investment_score_begruendung"),
    risikenInvestor: jsonb("risiken_investor").default(sql`'[]'::jsonb`),
    fixFlipMassnahmen: jsonb("fix_flip_massnahmen").default(sql`'[]'::jsonb`), // [{beschreibung, kategorie, kosten_min_eur, kosten_max_eur, prioritaet}]
    fixFlipWerteinschaetzung: text("fix_flip_werteinschaetzung"),
    fixFlipGesamtkostenMinEur: integer("fix_flip_gesamtkosten_min_eur"),
    fixFlipGesamtkostenMaxEur: integer("fix_flip_gesamtkosten_max_eur"),

    // Fix & Flip Deal-Kalkulation (Ziel 6, 2026-07-09, siehe
    // drizzle/migrations/0012_fix_flip_deal.sql + scrapers/src/models/zvg.py
    // FixFlipDealSchaetzung). Hier stehen nur noch die geschaetzten
    // Eingangsgroessen. Gewinn, ROI und Marge lagen bis 0023 als Spalten
    // daneben, mit Kaufpreis = Verkehrswert gerechnet, waehrend das Web
    // dieselben Objekte gegen ein Referenzgebot rechnete; gerechnet wird
    // jetzt nur noch in apps/web/lib/underwriting.
    arvMinEur: integer("arv_min_eur"),
    arvMaxEur: integer("arv_max_eur"),
    arvBegruendung: text("arv_begruendung"),
    arvKonfidenz: text("arv_konfidenz"), // 'hoch'|'mittel'|'niedrig'
    holdingMonate: smallint("holding_monate").default(9),

    // Metadaten
    modelUsed: text("model_used"),
    tokensUsed: integer("tokens_used"),
    analyzedAt: timestamp("analyzed_at").default(sql`NOW()`),
    analysisTier: text("analysis_tier").notNull().default("full"),
    fullStatus: text("full_status").notNull().default("idle"),
    fullRequestedBy: uuid("full_requested_by").references(() => users.id, { onDelete: "set null" }),
    fullRequestedAt: timestamp("full_requested_at"),
  },
  (t) => ({
    uniqueListingId: unique().on(t.listingId),
    fullRequestedByAt: index("idx_zvg_ki_analyses_full_requested_by_at").on(
      t.fullRequestedBy,
      t.fullRequestedAt,
    ),
  }),
);

/**
 * Terminhistorie: eine Zeile je beobachtetem Stand von Termin und
 * Verkehrswert. Der Scraper haengt an, sobald sich einer der beiden Werte
 * gegenueber der letzten Beobachtung aendert (siehe
 * scrapers/src/storage/postgres.py::_append_auction_event). Daraus entstehen
 * die beiden staerksten Hidden-Gem-Signale: Wiederholungstermin und
 * Verkehrswert-Reduktion.
 */
export const zvgAuctionEvents = pgTable(
  "zvg_auction_events",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => zvgListings.id, { onDelete: "cascade" }),
    terminDate: timestamp("termin_date", { withTimezone: true }),
    verkehrswert: decimal("verkehrswert", { precision: 14, scale: 0 }),
    // Aus der Terminsbestimmung gelesen. NULL heisst unbekannt — bewusst
    // nie verkehrswert * 0,7, sonst waere eine Schaetzung nicht mehr von
    // einer Rechtstatsache zu unterscheiden.
    geringstesGebot: decimal("geringstes_gebot", { precision: 14, scale: 0 }),
    bestehendeRechteEur: decimal("bestehende_rechte_eur", {
      precision: 14,
      scale: 0,
    }),
    bestehendeRechteText: text("bestehende_rechte_text"),
    termsQuelle: text("terms_quelle"),
    status: text("status").notNull().default("angesetzt"),
    quelle: text("quelle"),
    erfasstAm: timestamp("erfasst_am", { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
  },
  (t) => ({
    idxListing: index("idx_zvg_auction_events_listing").on(t.listingId, t.erfasstAm),
    idxTermin: index("idx_zvg_auction_events_termin").on(t.terminDate),
    uniqueStand: unique("zvg_auction_events_listing_stand_unique").on(
      t.listingId,
      t.terminDate,
      t.verkehrswert,
    ),
  }),
);

export const zvgImages = pgTable(
  "zvg_images",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    listingId: uuid("listing_id").references(() => zvgListings.id, { onDelete: "cascade" }),
    storagePath: text("storage_path").notNull(),
    publicUrl: text("public_url"),
    position: smallint("position"),
    isCover: boolean("is_cover").default(false),
    width: integer("width"),
    height: integer("height"),
    createdAt: timestamp("created_at").default(sql`NOW()`),
  },
  (t) => ({
    listingPosition: uniqueIndex("zvg_images_listing_position_uidx")
      .on(t.listingId, t.position)
      .where(sql`${t.listingId} IS NOT NULL AND ${t.position} IS NOT NULL`),
  }),
);
