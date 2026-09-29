DO $$
DECLARE
  rec record;
  candidate text;
  n int;
BEGIN
  FOR rec IN
    SELECT id, bundesland, slug
    FROM (
      SELECT
        id,
        bundesland,
        slug,
        ROW_NUMBER() OVER (
          PARTITION BY bundesland, slug
          ORDER BY ist_aktiv DESC NULLS LAST, last_seen_at DESC NULLS LAST, created_at DESC, id
        ) AS rn
      FROM zvg_listings
    ) t
    WHERE rn > 1
  LOOP
    n := 2;
    LOOP
      candidate := rec.slug || '-' || n::text;
      IF length(candidate) > 200 THEN
        candidate := left(rec.slug, 167) || '-' || replace(rec.id::text, '-', '');
      END IF;
      EXIT WHEN NOT EXISTS (
        SELECT 1
        FROM zvg_listings
        WHERE bundesland = rec.bundesland
          AND slug = candidate
          AND id <> rec.id
      );
      n := n + 1;
      IF n > 50 THEN
        candidate := left(rec.slug, 167) || '-' || replace(rec.id::text, '-', '');
        EXIT;
      END IF;
    END LOOP;
    UPDATE zvg_listings SET slug = candidate WHERE id = rec.id;
  END LOOP;
END $$;

ALTER TABLE zvg_listings
  ADD CONSTRAINT zvg_listings_bundesland_slug_unique UNIQUE (bundesland, slug);
