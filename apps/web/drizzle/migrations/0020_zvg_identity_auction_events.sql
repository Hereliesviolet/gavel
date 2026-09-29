-- Objektidentität und Terminhistorie.
--
-- 1. Identität: bisher (aktenzeichen, source, bundesland). Zwei Amtsgerichte im
--    selben Bundesland vergeben dieselben Aktenzeichen — 54 Aktenzeichen waren
--    dadurch mehrfach vergeben. Neuer Schlüssel ist
--    (bundesland, amtsgericht, aktenzeichen); der Teilobjekt-Suffix steckt
--    bereits im Aktenzeichen ("…#2"). `source` fällt aus dem Schlüssel: ein
--    Gerichtsverfahren ist dasselbe Objekt, egal über welches Portal wir es
--    sehen. Geprüft: aktuell gibt es null Gruppen, die dadurch verschmelzen
--    würden, die Umstellung ist also verlustfrei.
--    amtsgericht ist bei justizportal teilweise NULL — COALESCE auf '' hält
--    diese Zeilen dedupliziert, statt sie durch die NULL-Semantik von UNIQUE
--    bei jedem Scrape neu einzufügen.
--
-- 2. zvg_auction_events: eine Zeile je beobachtetem Terminstand. Bisher gab es
--    nur ein einziges termin_date, das bei jedem Scrape überschrieben wurde —
--    Wiederholungstermine und Verkehrswert-Reduktionen, die stärksten
--    Hidden-Gem-Signale, waren dadurch unsichtbar.

ALTER TABLE zvg_listings
  DROP CONSTRAINT IF EXISTS zvg_listings_aktenzeichen_source_bundesland_unique;

CREATE UNIQUE INDEX IF NOT EXISTS uq_zvg_listings_identitaet
  ON zvg_listings (bundesland, COALESCE(amtsgericht, ''), aktenzeichen);

CREATE TABLE IF NOT EXISTS zvg_auction_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES zvg_listings(id) ON DELETE CASCADE,
  termin_date timestamptz,
  verkehrswert numeric(14, 0),
  -- Wird erst mit Schritt 3 aus der Terminsbestimmung geparst. Bis dahin NULL
  -- statt einer geratenen Ableitung aus dem Verkehrswert.
  geringstes_gebot numeric(14, 0),
  status text NOT NULL DEFAULT 'angesetzt',
  quelle text,
  erfasst_am timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT zvg_auction_events_status_check
    CHECK (status IN ('angesetzt', 'aufgehoben', 'abgehalten'))
);

CREATE INDEX IF NOT EXISTS idx_zvg_auction_events_listing
  ON zvg_auction_events (listing_id, erfasst_am DESC);
CREATE INDEX IF NOT EXISTS idx_zvg_auction_events_termin
  ON zvg_auction_events (termin_date);

-- Backfill: der heute bekannte Stand wird der erste Termin je Objekt. Eine
-- echte Historie lässt sich nicht rekonstruieren, weil die Vorwerte beim
-- Überschreiben verloren gegangen sind. Ab hier wächst sie bei jedem Scrape.
INSERT INTO zvg_auction_events (listing_id, termin_date, verkehrswert, quelle, erfasst_am)
SELECT l.id, l.termin_date, l.verkehrswert, l.source, COALESCE(l.created_at, NOW())
FROM zvg_listings l
WHERE (l.termin_date IS NOT NULL OR l.verkehrswert IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM zvg_auction_events e WHERE e.listing_id = l.id
  );
