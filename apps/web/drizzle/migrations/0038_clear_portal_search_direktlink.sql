UPDATE zvg_listings
SET direktlink = NULL
WHERE source = 'justizportal'
  AND direktlink IS NOT NULL
  AND direktlink NOT LIKE '%button=showZvg%'
  AND (
    direktlink LIKE '%button=Termine+suchen%'
    OR direktlink LIKE '%button=Suchen%'
  );
