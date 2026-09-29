-- Custom-URL-Analyse-Feature (Baustein 3 der Firecrawl-Migration, 2026-07-08).
-- Siehe docs/FIRECRAWL_MIGRATION.md, apps/web/drizzle/schema/immobilien.ts.
--
-- 1. Aktiviert real_estate_listings: existierte bisher NUR als Drizzle-Schema
--    (apps/web/drizzle/schema/immobilien.ts), wurde nie migriert und von
--    keinem App-Code befüllt. Ab jetzt genutzt vom Custom-URL-Analyse-Feature
--    (FastAPI-Endpunkt POST /internal/analyze-url im Scraper-Container).
--    Zusätzlich submitted_by_user_id, damit eine Verlaufsansicht ("meine
--    bisherigen Analysen") pro Nutzer möglich ist.
--
-- 2. Neue Tabelle real_estate_ki_analyses: EIGENSTÄNDIGE KI-Analyse-Struktur,
--    NICHT zvg_ki_analyses zweckentfremdet (andere Domäne - dort
--    Gutachten-Extraktion für Zwangsversteigerungen, hier Markt-Fairness-
--    Bewertung eines frei inserierten Angebots: Preisvergleich, Stärken/
--    Schwächen, Lage, optionale Rendite-Schätzung bei Mietobjekten).
--
-- 3. Neue Tabelle custom_url_requests: Audit-Log OHNE Rate-Limit-Enforcement
--    für v1 (aber vorbereitet dafür, siehe Plan) - protokolliert jeden
--    Analyse-Versuch (Erfolg wie Fehler) inkl. Fehlermeldung.
--
-- Additiv/non-destruktiv: CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT
-- EXISTS. Angewendet per docker exec/psql direkt gegen immopulse_postgres
-- (analog zu Migration 0004-0006).

CREATE TABLE IF NOT EXISTS "real_estate_listings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "external_id" text NOT NULL,
  "source" text NOT NULL,
  "source_url" text NOT NULL,

  "typ" text,
  "angebotstyp" text,
  "titel" text,
  "adresse" text,
  "plz" text,
  "ort" text,
  "lat" decimal(10, 7),
  "lng" decimal(10, 7),

  "preis" integer,
  "preis_pro_m2" decimal(10, 2),
  "wohnflaeche_m2" decimal(10, 2),
  "zimmer" decimal(4, 1),
  "baujahr" smallint,
  "effizienzklasse" text,
  "cover_image_url" text,

  "ist_aktiv" boolean DEFAULT true,
  "raw_data" jsonb,
  "scraped_at" timestamp DEFAULT NOW(),
  "first_seen_at" timestamp DEFAULT NOW(),
  "last_seen_at" timestamp DEFAULT NOW(),

  CONSTRAINT "real_estate_listings_external_id_source_unique" UNIQUE ("external_id", "source")
);

ALTER TABLE "real_estate_listings"
  ADD COLUMN IF NOT EXISTS "submitted_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "idx_real_estate_listings_submitted_by"
  ON "real_estate_listings" ("submitted_by_user_id");

CREATE TABLE IF NOT EXISTS "real_estate_ki_analyses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "listing_id" uuid NOT NULL REFERENCES "real_estate_listings"("id") ON DELETE CASCADE,

  "preis_bewertung" text,
  "preis_abweichung_pct" decimal(6, 2),
  "staerken" jsonb DEFAULT '[]'::jsonb,
  "schwaechen" jsonb DEFAULT '[]'::jsonb,
  "lage_bewertung" text,
  "rendite_geschaetzt_pct" decimal(6, 2),
  "zusammenfassung" text,

  "model_used" text,
  "tokens_used" integer DEFAULT 0,
  "analyzed_at" timestamptz DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_real_estate_ki_analyses_listing_id"
  ON "real_estate_ki_analyses" ("listing_id");

CREATE TABLE IF NOT EXISTS "custom_url_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
  "url" text NOT NULL,
  "status" text NOT NULL,
  "error_message" text,
  "listing_id" uuid REFERENCES "real_estate_listings"("id") ON DELETE SET NULL,
  "requested_at" timestamptz DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_custom_url_requests_user_id"
  ON "custom_url_requests" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_custom_url_requests_requested_at"
  ON "custom_url_requests" ("requested_at");
