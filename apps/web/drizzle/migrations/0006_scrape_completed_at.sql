-- Vollständigkeits-Gate für die KI-Analyse (Baustein 2 der Firecrawl-Migration,
-- 2026-07-07/08). Siehe docs/FIRECRAWL_MIGRATION.md.
--
-- Hintergrund: last_seen_at (Migration 0004) bedeutet nur "zuletzt von der
-- Quelle in der Ergebnisliste gesehen" - das sagt NICHTS über die
-- Vollständigkeit des Detail-Scrapes aus (Bilder/Gutachten/Exposé-Download).
-- get_listings_without_ki() (scrapers/src/flows/ki_analysis.py) nutzte bisher
-- eine Text-Heuristik (Beschreibung > 50 Zeichen ODER gutachten_url ODER
-- expose_url vorhanden), die auch bei einem NUR TEILWEISE abgeschlossenen
-- Detail-Scrape (z.B. Netzwerkfehler nach dem Beschreibungstext, aber vor dem
-- PDF-Download) bereits zuschlägt - die KI würde dann mit unvollständigem
-- Kontext analysieren, ohne dass das irgendwo sichtbar wird.
--
-- scrape_completed_at wird stattdessen explizit am ENDE der
-- Detail-Anreicherung jedes einzelnen Listings gesetzt (nach Bild-/
-- Dokument-Download), in allen drei Scrapern (zvg_portal.py, zvg_com.py,
-- hanmark.py). NULL bleibt es, wenn der Detail-Scrape (noch) nicht
-- vollständig gelaufen ist - die KI-Analyse wartet dann auf den nächsten Lauf.
--
-- Additiv, nicht-destruktiv: NULL für alle bereits bestehenden Zeilen ist
-- bewusst OHNE Default-Backfill (kein "DEFAULT NOW()" wie bei last_seen_at),
-- da wir für bereits bestehende Listings nicht wissen, ob ihr Detail-Scrape
-- tatsächlich vollständig war. get_listings_without_ki() würde sie sonst
-- fälschlich als "vollständig" behandeln. Ein einmaliges Backfill-Skript
-- (scrapers/backfill_scrape_completed_at.py) setzt scrape_completed_at für
-- bereits vollständig analysierte Bestandslistings nachträglich, siehe dort.
--
-- Angewendet per docker exec/psql direkt gegen immopulse_postgres (analog zu
-- Migration 0004/0005) - diese Datei dient der Dokumentation/
-- Nachvollziehbarkeit im Schema-Verlauf.

ALTER TABLE zvg_listings
  ADD COLUMN IF NOT EXISTS scrape_completed_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_zvg_scrape_completed_at
  ON zvg_listings (scrape_completed_at);
