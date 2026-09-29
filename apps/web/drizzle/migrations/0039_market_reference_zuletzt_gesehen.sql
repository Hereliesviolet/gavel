CREATE OR REPLACE VIEW market_reference AS
SELECT
  mikromarkt,
  kategorie,
  angebotstyp,
  count(*)::int AS stichprobe,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY preis_pro_m2)::numeric(10, 2) AS median_eur_m2,
  percentile_cont(0.25) WITHIN GROUP (ORDER BY preis_pro_m2)::numeric(10, 2) AS p25_eur_m2,
  percentile_cont(0.75) WITHIN GROUP (ORDER BY preis_pro_m2)::numeric(10, 2) AS p75_eur_m2,
  max(zuletzt_gesehen_am) AS stand
FROM market_comparables
WHERE ist_aktiv
  AND preis_pro_m2 IS NOT NULL
  AND preis_pro_m2 > 0
  AND zuletzt_gesehen_am > NOW() - INTERVAL '120 days'
GROUP BY mikromarkt, kategorie, angebotstyp;
