-- Ergänzt die Outcome-Schleife um die reale Haltedauer. Additiv und
-- idempotent, damit bereits mit 0018 angelegte Installationen sicher
-- nachgezogen werden können.
ALTER TABLE investor_deal_outcomes
  ADD COLUMN IF NOT EXISTS actual_holding_months integer;

ALTER TABLE investor_deal_outcomes
  DROP CONSTRAINT IF EXISTS investor_deal_outcomes_holding_months_check;
ALTER TABLE investor_deal_outcomes
  ADD CONSTRAINT investor_deal_outcomes_holding_months_check
  CHECK (actual_holding_months IS NULL OR actual_holding_months BETWEEN 0 AND 1200);
