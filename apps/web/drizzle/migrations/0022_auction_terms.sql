-- Terminsbestimmung: geringstes Gebot und bestehenbleibende Rechte.
--
-- Bis hierher hat die Oberflaeche das gerichtliche Mindestgebot mit
-- verkehrswert * 0,75 geraten und bestehenbleibende Rechte mit 0 angesetzt.
-- Beides steht in der amtlichen Bekanntmachung; ab jetzt wird es gelesen und
-- als Faktum gespeichert. Fehlt es, bleibt die Spalte NULL und die Oberflaeche
-- schreibt "nicht bekannt" statt einer geratenen Zahl.

ALTER TABLE zvg_auction_events
  ADD COLUMN IF NOT EXISTS bestehende_rechte_eur numeric(14, 0),
  ADD COLUMN IF NOT EXISTS bestehende_rechte_text text,
  ADD COLUMN IF NOT EXISTS terms_quelle text;

COMMENT ON COLUMN zvg_auction_events.geringstes_gebot IS
  'Aus der Terminsbestimmung gelesen. NULL heisst unbekannt, nie geschaetzt.';
COMMENT ON COLUMN zvg_auction_events.bestehende_rechte_eur IS
  'Kapitalisierter Wert bestehenbleibender Rechte laut geringstem Gebot.';
COMMENT ON COLUMN zvg_auction_events.terms_quelle IS
  'Woher die Terminsdaten stammen, z. B. expose_pdf.';
