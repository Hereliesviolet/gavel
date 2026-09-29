-- Progressive Reveal: Preview-Payload für laufende Analysen
ALTER TABLE custom_url_requests
  ADD COLUMN IF NOT EXISTS preview jsonb;

COMMENT ON COLUMN custom_url_requests.preview IS
  'Progressives Reveal {titel,preis,zimmer,ort,bildCount,preisBewertung,investmentScore}';
