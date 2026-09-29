-- Terminal-Stream: Append-Log für Analyse-Jobs (keine verlorenen Zwischenzeilen)
ALTER TABLE custom_url_requests
  ADD COLUMN IF NOT EXISTS step_log jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN custom_url_requests.step_log IS
  'Array von {t, msg, hb?, phase?} – Terminal-Historie der Async-Analyse';
