ALTER TABLE market_comparables
  DROP CONSTRAINT IF EXISTS market_comparables_kandidat_status_check;

ALTER TABLE market_comparables
  ADD CONSTRAINT market_comparables_kandidat_status_check
  CHECK (kandidat_status IN ('offen', 'gestartet', 'befoerdert', 'analysiert', 'verworfen'));
