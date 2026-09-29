-- Performance-Audit (2026-07-03): N5 + N6.
--
-- WICHTIG: CREATE INDEX CONCURRENTLY kann nicht innerhalb einer Transaktion
-- laufen (drizzle-kit migrate wrapped jede Migration in eine Transaktion).
-- Diese Datei dient daher nur der Dokumentation/Nachvollziehbarkeit - die
-- eigentliche Anwendung erfolgte live per psql/docker exec direkt gegen
-- immopulse_postgres (siehe Performance-Audit-Abschlussbericht), analog zu
-- migrations/0000 (H1, idx_zvg_images_listing_id_position, ebenfalls nicht
-- als eigene Migrationsdatei vorhanden, weil live nachgezogen).
--
-- N5: user_alerts.user_id wird in GET /api/alerts und
-- app/api/cron/check-alerts/route.ts gefiltert - aktuell 0 Zeilen, aber
-- günstig und zukunftssicher.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_alerts_user_id
  ON user_alerts (user_id);

-- N6: app/api/search-suggestions/route.ts nutzt ILIKE '%term%' auf
-- zvg_listings.ort und .adresse - dafür braucht es pg_trgm + GIN statt eines
-- normalen B-Tree-Index (der bei "contains"-Mustern nicht greift).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_zvg_ort_trgm
  ON zvg_listings USING gin (ort gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_zvg_adresse_trgm
  ON zvg_listings USING gin (adresse gin_trgm_ops);
