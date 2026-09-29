-- Fix 3 (RESCAN_FIXES_2026-07-08.md, Root Cause #2): Aktenzeichen-Kollision
-- zwischen Amtsgerichten/Bundeslaendern.
--
-- Hintergrund: Die bisherige Unique-Constraint (aktenzeichen, source) ist
-- ohne Bundesland/Amtsgericht nicht garantiert eindeutig - kurze
-- Aktenzeichen-Formate wie "K 0051/2025" (ohne fuehrende Amtsgerichts-
-- Nummer) kommen bei mehreren Amtsgerichten in VERSCHIEDENEN Bundeslaendern
-- vor. Kollidieren zwei solche Aktenzeichen, verschmilzt der bisherige
-- ON CONFLICT DO UPDATE zwei real unterschiedliche Objekte zu einer
-- "Frankenstein-Zeile" (Ortsdaten von Objekt A + Termin/Verkehrswert von
-- Objekt B), weil ort/plz/bundesland/adresse/strasse/amtsgericht dabei nie
-- aktualisiert wurden (siehe Fix in scrapers/src/storage/postgres.py).
--
-- Bewusst (aktenzeichen, source, bundesland) statt des im Audit-Report als
-- Beispiel genannten (aktenzeichen, source, amtsgericht): amtsgericht ist
-- bei justizportal (der mit Abstand am staerksten betroffenen Quelle) in
-- 395 von 414 Zeilen NULL (Zeilenlabel "in <Ort>" wird oft als
-- Bundesland-Name statt Amtsgericht erkannt und dann verworfen, siehe
-- zvg_portal.py/_parse_objekte_from_soup) - zwei NULL-Werte gelten in
-- SQL-Unique-Constraints NICHT als gleich, ein NULL-amtsgericht wuerde also
-- GAR KEINEN Schutz bieten. bundesland ist dagegen bei allen drei Quellen
-- eine NOT-NULL-Pflichtspalte (ZvgListing.bundesland: str) und spiegelt
-- direkt die Ursache wider (Kollision ZWISCHEN Bundeslaendern).
--
-- Vor dem Anlegen verifiziert (nicht nur angenommen): kein bestehendes
-- (aktenzeichen, source, bundesland)-Tripel ist aktuell doppelt vorhanden
-- (siehe RESCAN_FIXES_2026-07-08.md) - die neue, engere Constraint
-- verletzt also keine Bestandsdaten.
--
-- Vorher-Zustand der 3 bekannten betroffenen Zeilen gesichert unter
-- scrapers/audit_output/fix3_backup/betroffene_zeilen_vorher_2026-07-08.csv.
--
-- Angewendet per docker exec/psql direkt gegen immopulse_postgres (analog
-- zu Migration 0004-0007) - diese Datei dient der Dokumentation/
-- Nachvollziehbarkeit im Schema-Verlauf.

ALTER TABLE zvg_listings
  DROP CONSTRAINT IF EXISTS zvg_listings_aktenzeichen_source_unique;

ALTER TABLE zvg_listings
  ADD CONSTRAINT zvg_listings_aktenzeichen_source_bundesland_unique
  UNIQUE (aktenzeichen, source, bundesland);
