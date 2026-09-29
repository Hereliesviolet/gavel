-- Entfernt tote und widerspruechliche Geldspalten.
--
-- limit_75_pct / limit_50_pct: seit Bestehen des Schemas in 0 von 2121 Zeilen
-- befuellt. Kein Scraper hat sie je geschrieben, die Oberflaeche hat statt
-- dessen verkehrswert * 0,75 bzw. * 0,5 gerechnet und als gerichtliche
-- Bietgrenze ausgegeben. Die 5/10- und 7/10-Grenzen ergeben sich ohnehin
-- direkt aus dem Verkehrswert (§ 85a ZVG); das geringste Gebot steht in
-- zvg_auction_events und wird nicht geschaetzt.
--
-- flip_*: Gewinn, ROI, Marge und Opportunity-Score wurden vom Scraper mit
-- Kaufpreis = Verkehrswert berechnet, waehrend das Web dieselben Objekte mit
-- einem Referenzgebot rechnete. Dasselbe Objekt konnte deshalb gleichzeitig
-- "attraktive Fix&Flip-Chance" und negatives Underwriting anzeigen. Gerechnet
-- wird jetzt ausschliesslich in apps/web/lib/underwriting, beim Lesen und
-- gegen das aktuelle Investorenprofil. Die Eingangsgroessen (arv_*,
-- fix_flip_gesamtkosten_*, holding_monate) bleiben erhalten.

ALTER TABLE zvg_listings
  DROP COLUMN IF EXISTS limit_75_pct,
  DROP COLUMN IF EXISTS limit_50_pct;

ALTER TABLE zvg_ki_analyses
  DROP COLUMN IF EXISTS flip_gesamtinvestition_min_eur,
  DROP COLUMN IF EXISTS flip_gesamtinvestition_max_eur,
  DROP COLUMN IF EXISTS flip_gewinn_min_eur,
  DROP COLUMN IF EXISTS flip_gewinn_max_eur,
  DROP COLUMN IF EXISTS flip_roi_pct_min,
  DROP COLUMN IF EXISTS flip_roi_pct_max,
  DROP COLUMN IF EXISTS flip_opportunity_score,
  DROP COLUMN IF EXISTS flip_opportunity_begruendung,
  DROP COLUMN IF EXISTS flip_szenario;

ALTER TABLE real_estate_ki_analyses
  DROP COLUMN IF EXISTS flip_gesamtinvestition_min_eur,
  DROP COLUMN IF EXISTS flip_gesamtinvestition_max_eur,
  DROP COLUMN IF EXISTS flip_gewinn_min_eur,
  DROP COLUMN IF EXISTS flip_gewinn_max_eur,
  DROP COLUMN IF EXISTS flip_roi_pct_min,
  DROP COLUMN IF EXISTS flip_roi_pct_max,
  DROP COLUMN IF EXISTS flip_opportunity_score,
  DROP COLUMN IF EXISTS flip_opportunity_begruendung;
