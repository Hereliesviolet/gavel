DELETE FROM zvg_auction_events a
USING zvg_auction_events b
WHERE a.listing_id = b.listing_id
  AND a.termin_date IS NOT DISTINCT FROM b.termin_date
  AND a.verkehrswert IS NOT DISTINCT FROM b.verkehrswert
  AND a.erfasst_am > b.erfasst_am;

DELETE FROM zvg_auction_events a
USING zvg_auction_events b
WHERE a.listing_id = b.listing_id
  AND a.termin_date IS NOT DISTINCT FROM b.termin_date
  AND a.verkehrswert IS NOT DISTINCT FROM b.verkehrswert
  AND a.erfasst_am = b.erfasst_am
  AND a.id > b.id;

CREATE UNIQUE INDEX zvg_auction_events_listing_stand_unique
  ON zvg_auction_events (listing_id, termin_date, verkehrswert)
  NULLS NOT DISTINCT;
