-- Custom-URL-Analyse: Investoren-Einschätzung (Ziel 2, 2026-07-08).
-- Siehe apps/web/drizzle/schema/immobilien.ts, scrapers/src/models/real_estate.py
-- (CustomMarketAnalyse), scrapers/src/storage/real_estate.py
-- (insert_real_estate_ki_analyse), scrapers/src/api/app.py (_analyze_market_fairness).
--
-- real_estate_ki_analyses um Investoren-Einschätzung erweitert - BEWUSST
-- getrennt von den bereits bestehenden staerken/schwaechen (Markt-Fairness):
-- investment_score/investment_score_begruendung/risiken_investor bewerten
-- die Investitionsperspektive, cashflow_einschaetzung eine grobe
-- Netto-Cashflow-Tendenz bei Kaufangeboten mit erkennbarer Vermietbarkeit.
--
-- Additiv/non-destruktiv: ADD COLUMN IF NOT EXISTS. Angewendet per
-- docker exec/psql direkt gegen immopulse_postgres (analog zu Migration 0007).

ALTER TABLE "real_estate_ki_analyses"
  ADD COLUMN IF NOT EXISTS "investment_score" text,
  ADD COLUMN IF NOT EXISTS "investment_score_begruendung" text,
  ADD COLUMN IF NOT EXISTS "risiken_investor" jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "cashflow_einschaetzung" text;
