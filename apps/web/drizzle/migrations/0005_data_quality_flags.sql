-- Proaktive Datenqualitäts-Validierungsschicht (2026-07-04).
--
-- Hintergrund: Mehrere konkrete Datenfehler (fehlendes Geocoding,
-- Bundesland-Slug-Chaos, KI-Flächenzuordnung beim falschen Teilobjekt einer
-- Mehrfach-Los-Zwangsversteigerung) wurden bisher ausschließlich reaktiv
-- gefunden. Diese Migration legt die Grundlage für eine dauerhafte,
-- automatische Erkennung: eine nachgelagerte Regel-Engine
-- (scrapers/src/utils/data_quality.py) prüft nach jedem Scraping-/
-- KI-Lauf alle wichtigen Felder auf Plausibilität und schreibt Auffälligkeiten
-- hierher, statt sie stillschweigend zu verwerfen oder zu überschreiben.
-- Siehe docs/DATA_QUALITY.md für die vollständige Beschreibung.
--
-- data_quality_flags: JSONB-Array von {field, reason, message, severity,
--   value, expected, rules_version} - ein Eintrag pro erkannter Auffälligkeit.
-- needs_review: true, sobald mindestens ein Flag severity in {warning,critical}
--   hat - dient als schneller Filter (Index unten) für Review-Listen/Reports.
-- data_quality_checked_at: Zeitpunkt der letzten Prüfung (für Monitoring, ob
--   der tägliche Check überhaupt noch läuft).
--
-- NOT NULL mit DEFAULT ist bei ALTER TABLE auf einer bestehenden Tabelle mit
-- Zeilen unkritisch (Postgres befüllt bestehende Zeilen mit dem Default,
-- kein Datenverlust, keine Downtime-relevante Tabellensperre bei diesen
-- einfachen Skalartypen).
--
-- Angewendet wurde diese Änderung live per docker exec/psql direkt gegen
-- immopulse_postgres (analog zu migrations/0003+0004, siehe Kommentare dort) -
-- diese Datei dient der Dokumentation/Nachvollziehbarkeit im Schema-Verlauf.

ALTER TABLE zvg_listings
  ADD COLUMN IF NOT EXISTS data_quality_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS needs_review BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS data_quality_checked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_zvg_needs_review
  ON zvg_listings (needs_review) WHERE needs_review = TRUE;

CREATE INDEX IF NOT EXISTS idx_zvg_data_quality_flags
  ON zvg_listings USING gin (data_quality_flags);

-- Tägliche Zusammenfassung (Prefect-Flow data_quality.py, Schritt
-- "generate-data-quality-report") für Trendvergleich zum Vortag +
-- Report-Versand, siehe daily_pipeline.py.
CREATE TABLE IF NOT EXISTS data_quality_daily_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stat_date DATE NOT NULL UNIQUE,
  total_active INTEGER NOT NULL,
  total_needs_review INTEGER NOT NULL,
  by_source JSONB NOT NULL DEFAULT '{}'::jsonb,
  by_reason JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
