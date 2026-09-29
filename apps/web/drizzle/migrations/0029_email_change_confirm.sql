ALTER TABLE users
  ADD COLUMN IF NOT EXISTS pending_email text,
  ADD COLUMN IF NOT EXISTS pending_email_token_hash text,
  ADD COLUMN IF NOT EXISTS pending_email_expires_at timestamp;

CREATE UNIQUE INDEX IF NOT EXISTS users_pending_email_lower_idx
  ON users (lower(pending_email));
