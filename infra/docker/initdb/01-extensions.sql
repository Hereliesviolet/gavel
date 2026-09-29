-- Runs once, when the Postgres data directory is first initialised.
-- The trigram indexes on zvg_listings (ort, adresse) need pg_trgm.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
