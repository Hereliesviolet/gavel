-- Der Deal-Desk macht aus dem Outcome-Eintrag einen echten Pipeline-Status.
-- Zwischen "beobachten" und "geboten" fehlte der Zustand, in dem die eigentliche
-- Arbeit passiert: Unterlagen lesen, Objekt ansehen, Zahlen nachrechnen.
ALTER TABLE investor_deal_outcomes
  DROP CONSTRAINT IF EXISTS investor_deal_outcomes_status_check;

ALTER TABLE investor_deal_outcomes
  ADD CONSTRAINT investor_deal_outcomes_status_check
  CHECK (status IN ('watching', 'examining', 'bid', 'acquired', 'rejected', 'sold'));
