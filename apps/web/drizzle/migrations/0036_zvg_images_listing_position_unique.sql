DELETE FROM zvg_images a
USING zvg_images b
WHERE a.listing_id IS NOT NULL
  AND a.listing_id = b.listing_id
  AND a.position IS NOT DISTINCT FROM b.position
  AND (
    a.created_at < b.created_at
    OR (
      a.created_at IS NOT DISTINCT FROM b.created_at
      AND a.ctid < b.ctid
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS zvg_images_listing_position_uidx
  ON zvg_images (listing_id, position)
  WHERE listing_id IS NOT NULL AND position IS NOT NULL;
