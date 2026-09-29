-- Custom-URL-Analyse: Bild-Pipeline (Ziel 1, 2026-07-08).
-- Siehe apps/web/drizzle/schema/immobilien.ts, scrapers/src/api/app.py,
-- scrapers/src/storage/real_estate.py, scrapers/src/storage/minio.py.
--
-- Neue Tabelle real_estate_images: Pendant zu zvg_images. Bisher wurde nur
-- extraction.bilder[0] als externe cover_image_url gespeichert, NIE nach
-- MinIO hochgeladen. Ab jetzt lädt scrapers/src/api/app.py alle erkannten
-- Bilder (Obergrenze 12) nach MinIO hoch (Bucket "zvg-images", Pfad-Präfix
-- "real-estate/{listing_id}/...") und speichert sie hier.
--
-- Additiv/non-destruktiv: CREATE TABLE IF NOT EXISTS. Angewendet per
-- docker exec/psql direkt gegen immopulse_postgres (analog zu Migration 0007).

CREATE TABLE IF NOT EXISTS "real_estate_images" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "listing_id" uuid NOT NULL REFERENCES "real_estate_listings"("id") ON DELETE CASCADE,
  "storage_path" text NOT NULL,
  "public_url" text,
  "position" smallint,
  "created_at" timestamp DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_real_estate_images_listing_id"
  ON "real_estate_images" ("listing_id");
