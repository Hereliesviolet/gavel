UPDATE zvg_listings
SET ist_neu = COALESCE(created_at >= (NOW() - INTERVAL '24 hours'), FALSE)
WHERE ist_neu IS DISTINCT FROM COALESCE(created_at >= (NOW() - INTERVAL '24 hours'), FALSE);
