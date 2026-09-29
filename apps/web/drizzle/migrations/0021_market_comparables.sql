-- Unabhängige Marktreferenz aus Portal-Angebotspreisen.
--
-- Bewusst getrennt von real_estate_listings: dort liegen die Objekte, die ein
-- Nutzer selbst eingereicht hat — eine selektionsverzerrte Stichprobe. Für
-- Vergleichswerte brauchen wir systematische, periodisch erneuerte Abdeckung
-- je Mikromarkt ohne Nutzerbezug.
--
-- Angebotspreise liegen systematisch über realisierten Preisen. Das Label in
-- der UI heißt deshalb immer "Angebotspreis-Niveau", nie "Marktwert".

CREATE TABLE IF NOT EXISTS market_comparables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quelle text NOT NULL,
  externe_id text NOT NULL,
  url text NOT NULL,
  angebotstyp text NOT NULL,
  kategorie text NOT NULL,
  titel text,
  plz text NOT NULL,
  -- Dreistelliges PLZ-Präfix als Mikromarkt. Ein echter Kreisschlüssel würde
  -- einen externen Datensatz erfordern, den das Repo nicht hat; PLZ-3 liefert
  -- rund 660 Gebiete bundesweit und damit eine ähnliche Körnung wie die 400
  -- Kreise. Das Label in der UI benennt die Näherung.
  mikromarkt text NOT NULL,
  ort text,
  wohnflaeche_m2 numeric(10, 2),
  zimmer numeric(4, 1),
  preis_eur integer,
  preis_pro_m2 numeric(10, 2),
  -- Beförderung an die Custom-Analyse: offen -> befoerdert -> analysiert.
  -- 'verworfen', wenn die Anti-Signal-Vorprüfung greift.
  kandidat_status text NOT NULL DEFAULT 'offen',
  kandidat_grund text,
  befoerdert_am timestamptz,
  erfasst_am timestamptz NOT NULL DEFAULT NOW(),
  zuletzt_gesehen_am timestamptz NOT NULL DEFAULT NOW(),
  ist_aktiv boolean NOT NULL DEFAULT true,
  CONSTRAINT market_comparables_quelle_externe_id_unique UNIQUE (quelle, externe_id),
  CONSTRAINT market_comparables_angebotstyp_check
    CHECK (angebotstyp IN ('kauf', 'miete')),
  CONSTRAINT market_comparables_kandidat_status_check
    CHECK (kandidat_status IN ('offen', 'befoerdert', 'analysiert', 'verworfen'))
);

CREATE INDEX IF NOT EXISTS idx_market_comparables_markt
  ON market_comparables (mikromarkt, kategorie, angebotstyp)
  WHERE ist_aktiv;
CREATE INDEX IF NOT EXISTS idx_market_comparables_erfasst
  ON market_comparables (erfasst_am DESC);
CREATE INDEX IF NOT EXISTS idx_market_comparables_kandidat
  ON market_comparables (kandidat_status, erfasst_am DESC);

-- Preis- und Standzeitbeobachtung analysierter Marktobjekte. Liefert die
-- Signale "Preis gesenkt" und "lange am Markt" und markiert verschwundene
-- Anzeigen — der schnellste Kalibrierungspfad, weil er ohne eigenes Gebot
-- beobachtbare Ergebnisse liefert.
CREATE TABLE IF NOT EXISTS market_listing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid REFERENCES real_estate_listings(id) ON DELETE CASCADE,
  comparable_id uuid REFERENCES market_comparables(id) ON DELETE CASCADE,
  preis_eur integer,
  status text NOT NULL DEFAULT 'online',
  beobachtet_am timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT market_listing_events_status_check
    CHECK (status IN ('online', 'preis_gesenkt', 'preis_erhoeht', 'verschwunden')),
  CONSTRAINT market_listing_events_ziel_check
    CHECK (listing_id IS NOT NULL OR comparable_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_market_listing_events_listing
  ON market_listing_events (listing_id, beobachtet_am DESC);
CREATE INDEX IF NOT EXISTS idx_market_listing_events_comparable
  ON market_listing_events (comparable_id, beobachtet_am DESC);

-- Referenzniveau je Mikromarkt, Kategorie und Angebotstyp. Als View, damit sie
-- nie veraltet: der Bestand liegt im niedrigen fünfstelligen Bereich, eine
-- Materialisierung würde nur einen Aktualisierungsjob nötig machen, ohne etwas
-- zu beschleunigen. Anzeigen älter als 120 Tage fallen heraus.
CREATE OR REPLACE VIEW market_reference AS
SELECT
  mikromarkt,
  kategorie,
  angebotstyp,
  count(*)::int AS stichprobe,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY preis_pro_m2)::numeric(10, 2) AS median_eur_m2,
  percentile_cont(0.25) WITHIN GROUP (ORDER BY preis_pro_m2)::numeric(10, 2) AS p25_eur_m2,
  percentile_cont(0.75) WITHIN GROUP (ORDER BY preis_pro_m2)::numeric(10, 2) AS p75_eur_m2,
  max(erfasst_am) AS stand
FROM market_comparables
WHERE ist_aktiv
  AND preis_pro_m2 IS NOT NULL
  AND preis_pro_m2 > 0
  AND erfasst_am > NOW() - INTERVAL '120 days'
GROUP BY mikromarkt, kategorie, angebotstyp;
