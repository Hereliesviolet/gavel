CREATE TABLE IF NOT EXISTS investor_digests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period        TEXT NOT NULL,
  period_key    TEXT NOT NULL,
  content       JSONB NOT NULL,
  model_used    TEXT,
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(period, period_key)
);
