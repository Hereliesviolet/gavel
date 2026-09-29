-- Ziel A+B+C: Investoren-Analyse (ZVG) + Fix&Flip (beide Domänen), 2026-07-08.
-- Siehe apps/web/drizzle/schema/zvg.ts (zvgKiAnalyses), immobilien.ts
-- (realEstateKiAnalyses), scrapers/src/models/zvg.py (KIAnalyseResult),
-- scrapers/src/models/real_estate.py (CustomMarketAnalyse),
-- scrapers/src/storage/postgres.py (upsert_ki_analyse),
-- scrapers/src/storage/real_estate.py (insert_real_estate_ki_analyse).
--
-- zvg_ki_analyses: investment_score/investment_score_begruendung/
-- risiken_investor sind hier NEU (Pendant zu den bereits in Migration 0010
-- für real_estate_ki_analyses angelegten Feldern - siehe Aufgabenkontext:
-- dort bereits vorhanden, hier bewusst separat für die ZVG-Domäne ergänzt).
-- fix_flip_* ist in BEIDEN Tabellen neu, mit ABSICHTLICH identischen
-- Spaltennamen (Voraussetzung für die gemeinsame Frontend-Komponente
-- InvestmentFixFlipSection).
--
-- Additiv/non-destruktiv: ADD COLUMN IF NOT EXISTS. Angewendet per
-- docker exec/psql direkt gegen immopulse_postgres (analog zu Migration 0010).

ALTER TABLE "zvg_ki_analyses"
  ADD COLUMN IF NOT EXISTS "investment_score" text,
  ADD COLUMN IF NOT EXISTS "investment_score_begruendung" text,
  ADD COLUMN IF NOT EXISTS "risiken_investor" jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "fix_flip_massnahmen" jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "fix_flip_werteinschaetzung" text,
  ADD COLUMN IF NOT EXISTS "fix_flip_gesamtkosten_min_eur" integer,
  ADD COLUMN IF NOT EXISTS "fix_flip_gesamtkosten_max_eur" integer;

ALTER TABLE "real_estate_ki_analyses"
  ADD COLUMN IF NOT EXISTS "fix_flip_massnahmen" jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "fix_flip_werteinschaetzung" text,
  ADD COLUMN IF NOT EXISTS "fix_flip_gesamtkosten_min_eur" integer,
  ADD COLUMN IF NOT EXISTS "fix_flip_gesamtkosten_max_eur" integer;
