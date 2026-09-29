CREATE OR REPLACE FUNCTION immopulse_strip_sensitive_query(url text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  cleaned text;
BEGIN
  IF url IS NULL OR url = '' THEN
    RETURN url;
  END IF;
  cleaned := url;
  LOOP
    EXIT WHEN cleaned !~* '[?&](token|access_token|refresh_token|id_token|session|code|auth|key|api_key|apikey|signature|sid|secret)=';
    cleaned := regexp_replace(
      cleaned,
      '[?&](token|access_token|refresh_token|id_token|session|code|auth|key|api_key|apikey|signature|sid|secret)=[^&#]*',
      '',
      'i'
    );
  END LOOP;
  cleaned := regexp_replace(cleaned, '^([^?#]+)&', '\1?');
  cleaned := regexp_replace(cleaned, '\?&+', '?');
  cleaned := regexp_replace(cleaned, '&&+', '&');
  cleaned := regexp_replace(cleaned, '[?&]+$', '');
  RETURN cleaned;
END;
$$;

CREATE OR REPLACE FUNCTION immopulse_strip_external_id(external_id text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF external_id IS NULL OR position('#owner:' in external_id) = 0 THEN
    RETURN immopulse_strip_sensitive_query(external_id);
  END IF;
  RETURN immopulse_strip_sensitive_query(split_part(external_id, '#owner:', 1))
    || '#owner:'
    || split_part(external_id, '#owner:', 2);
END;
$$;

UPDATE real_estate_listings
SET source_url = immopulse_strip_sensitive_query(source_url)
WHERE source_url IS DISTINCT FROM immopulse_strip_sensitive_query(source_url);

UPDATE real_estate_listings AS l
SET external_id = immopulse_strip_external_id(l.external_id)
WHERE l.external_id IS DISTINCT FROM immopulse_strip_external_id(l.external_id)
  AND NOT EXISTS (
    SELECT 1
    FROM real_estate_listings AS o
    WHERE o.source = l.source
      AND o.id <> l.id
      AND o.external_id = immopulse_strip_external_id(l.external_id)
  );

UPDATE custom_url_requests
SET url = immopulse_strip_sensitive_query(url)
WHERE url IS DISTINCT FROM immopulse_strip_sensitive_query(url);

DROP FUNCTION immopulse_strip_external_id(text);
DROP FUNCTION immopulse_strip_sensitive_query(text);
