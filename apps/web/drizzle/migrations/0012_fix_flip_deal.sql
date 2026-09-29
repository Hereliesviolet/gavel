-- Ziel 6: Fix&Flip Deal-Kalkulation (ARV, Gesamtinvestition, Gewinn, ROI,
-- Opportunity-Score), 2026-07-09. Siehe apps/web/drizzle/schema/zvg.ts
-- (zvgKiAnalyses), immobilien.ts (realEstateKiAnalyses),
-- scrapers/src/models/zvg.py (FixFlipDealSchaetzung),
-- scrapers/src/models/real_estate.py (FixFlipDealSchaetzung),
-- scrapers/src/utils/fix_flip_calc.py (berechne_fix_flip_deal - ALLE
-- Euro-Beträge/ROI werden SERVERSEITIG in Python berechnet, NIE vom LLM),
-- scrapers/src/storage/postgres.py (upsert_ki_analyse),
-- scrapers/src/storage/real_estate.py (insert_real_estate_ki_analyse).
--
-- arv_* + holding_monate kommen vom LLM (zweiter, kleiner Call - siehe
-- FixFlipDealSchaetzung). flip_gesamtinvestition_*/flip_gewinn_*/
-- flip_roi_pct_*/flip_opportunity_* sind serverseitig berechnet.
-- flip_szenario (jsonb) ist NUR bei ZVG befüllt (zweites Szenario mit
-- limit_75_pct als Gebot) - bei Custom-URL-Analysen bleibt die Spalte NULL
-- (keine ZVG-Gebotslogik) - Spalte trotzdem in BEIDEN Tabellen mit
-- ABSICHTLICH identischen Namen angelegt (Voraussetzung für die gemeinsame
-- Frontend-Komponente InvestmentFixFlipSection, siehe Migration 0011).
--
-- Additiv/non-destruktiv: ADD COLUMN IF NOT EXISTS. Angewendet per
-- docker exec/psql direkt gegen immopulse_postgres (analog zu Migration 0011).

ALTER TABLE "zvg_ki_analyses"
  ADD COLUMN IF NOT EXISTS "arv_min_eur" integer,
  ADD COLUMN IF NOT EXISTS "arv_max_eur" integer,
  ADD COLUMN IF NOT EXISTS "arv_begruendung" text,
  ADD COLUMN IF NOT EXISTS "arv_konfidenz" text,
  ADD COLUMN IF NOT EXISTS "holding_monate" smallint DEFAULT 9,
  ADD COLUMN IF NOT EXISTS "flip_gesamtinvestition_min_eur" integer,
  ADD COLUMN IF NOT EXISTS "flip_gesamtinvestition_max_eur" integer,
  ADD COLUMN IF NOT EXISTS "flip_gewinn_min_eur" integer,
  ADD COLUMN IF NOT EXISTS "flip_gewinn_max_eur" integer,
  ADD COLUMN IF NOT EXISTS "flip_roi_pct_min" decimal(6, 2),
  ADD COLUMN IF NOT EXISTS "flip_roi_pct_max" decimal(6, 2),
  ADD COLUMN IF NOT EXISTS "flip_opportunity_score" text,
  ADD COLUMN IF NOT EXISTS "flip_opportunity_begruendung" text,
  ADD COLUMN IF NOT EXISTS "flip_szenario" jsonb;

ALTER TABLE "real_estate_ki_analyses"
  ADD COLUMN IF NOT EXISTS "arv_min_eur" integer,
  ADD COLUMN IF NOT EXISTS "arv_max_eur" integer,
  ADD COLUMN IF NOT EXISTS "arv_begruendung" text,
  ADD COLUMN IF NOT EXISTS "arv_konfidenz" text,
  ADD COLUMN IF NOT EXISTS "holding_monate" smallint DEFAULT 9,
  ADD COLUMN IF NOT EXISTS "flip_gesamtinvestition_min_eur" integer,
  ADD COLUMN IF NOT EXISTS "flip_gesamtinvestition_max_eur" integer,
  ADD COLUMN IF NOT EXISTS "flip_gewinn_min_eur" integer,
  ADD COLUMN IF NOT EXISTS "flip_gewinn_max_eur" integer,
  ADD COLUMN IF NOT EXISTS "flip_roi_pct_min" decimal(6, 2),
  ADD COLUMN IF NOT EXISTS "flip_roi_pct_max" decimal(6, 2),
  ADD COLUMN IF NOT EXISTS "flip_opportunity_score" text,
  ADD COLUMN IF NOT EXISTS "flip_opportunity_begruendung" text,
  ADD COLUMN IF NOT EXISTS "flip_szenario" jsonb;
