-- Async Custom-URL-Analyse: Job-Status + Fortschrittsschritte
ALTER TABLE custom_url_requests
  ADD COLUMN IF NOT EXISTS step text,
  ADD COLUMN IF NOT EXISTS progress_pct integer,
  ADD COLUMN IF NOT EXISTS step_detail text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_custom_url_requests_user_status
  ON custom_url_requests (user_id, status);

COMMENT ON COLUMN custom_url_requests.status IS
  'queued|running|success|error';
COMMENT ON COLUMN custom_url_requests.step IS
  'queued|fetching|extracting|market|investment|images|done|failed';
