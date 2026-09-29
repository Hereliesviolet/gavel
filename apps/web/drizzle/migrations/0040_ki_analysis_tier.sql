ALTER TABLE zvg_ki_analyses
  ADD COLUMN IF NOT EXISTS analysis_tier text NOT NULL DEFAULT 'full',
  ADD COLUMN IF NOT EXISTS full_status text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS full_requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS full_requested_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_zvg_ki_analyses_full_requested_by_at
  ON zvg_ki_analyses (full_requested_by, full_requested_at);

COMMENT ON COLUMN zvg_ki_analyses.analysis_tier IS
  'basic = automatische Faktenextraktion, full = geteilte Investment-Analyse';
COMMENT ON COLUMN zvg_ki_analyses.full_status IS
  'idle|queued|running|error — nur für die User-Vollanalyse';
