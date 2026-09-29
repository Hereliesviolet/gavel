-- "Verschwunden"-Erkennung (2026-07-04).
--
-- Hintergrund: Objekte, die von einer Quelle (justiz-portal.de, zvg.com,
-- hanmark.de) entfernt/abgesagt/aufgehoben wurden, wurden bisher nicht
-- zuverlässig erkannt, solange termin_date noch in der Zukunft lag. Die neue
-- Spalte last_seen_at wird bei jedem erfolgreichen Scrape, der ein Listing in
-- den aktuellen Ergebnissen der Quelle findet, auf NOW() aktualisiert (siehe
-- upsert_zvg_listing in scrapers/src/storage/postgres.py). Der konsolidierte
-- Archivierungs-Mechanismus (scrapers/src/flows/archive_past_listings.py,
-- archive_expired.sh) archiviert aktive Listings automatisch, wenn
-- last_seen_at älter als die Toleranzschwelle (Standard: 3 Tage, siehe
-- MISSING_TOLERANCE_DAYS) ist – zusätzlich zum bestehenden
-- termin_date-Kriterium, als EIN konsistenter Mechanismus statt zweier
-- paralleler Systeme.
--
-- DEFAULT NOW() sorgt dafür, dass bestehende Zeilen beim ALTER TABLE einen
-- aktuellen Zeitstempel erhalten und nicht sofort fälschlich als
-- "verschwunden" archiviert werden.
--
-- Angewendet wurde diese Änderung live per docker exec/psql direkt gegen
-- immopulse_postgres (analog zu migrations/0003, siehe Kommentar dort) - diese
-- Datei dient der Dokumentation/Nachvollziehbarkeit im Schema-Verlauf.

ALTER TABLE zvg_listings
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_zvg_last_seen_at
  ON zvg_listings (last_seen_at);
