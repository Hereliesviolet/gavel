-- ImmoPulse Investor Overhaul P0-P3
-- Ausschließlich additive Tabellen: bestehende Listings, KI-Analysen und APIs
-- bleiben unverändert und können unabhängig zurückgerollt werden.

CREATE TABLE IF NOT EXISTS investor_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strategies jsonb NOT NULL DEFAULT '["buy_hold","fix_flip","unter_markt"]'::jsonb,
  max_equity_eur integer NOT NULL DEFAULT 150000,
  target_irr_pct numeric(6,2) NOT NULL DEFAULT 12,
  target_cash_on_cash_pct numeric(6,2) NOT NULL DEFAULT 6,
  target_flip_margin_pct numeric(6,2) NOT NULL DEFAULT 15,
  min_dscr numeric(5,2) NOT NULL DEFAULT 1.2,
  financing_rate_pct numeric(6,2) NOT NULL DEFAULT 4.5,
  repayment_rate_pct numeric(6,2) NOT NULL DEFAULT 2,
  equity_pct numeric(6,2) NOT NULL DEFAULT 20,
  max_holding_months integer NOT NULL DEFAULT 12,
  vacancy_pct numeric(6,2) NOT NULL DEFAULT 4,
  maintenance_eur_m2_year numeric(8,2) NOT NULL DEFAULT 15,
  regions jsonb NOT NULL DEFAULT '[]'::jsonb,
  property_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  renovation_capacity text NOT NULL DEFAULT 'medium',
  risk_tolerance text NOT NULL DEFAULT 'balanced',
  profile_version text NOT NULL DEFAULT 'investor-profile-v1',
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT investor_profiles_user_id_unique UNIQUE (user_id),
  CONSTRAINT investor_profiles_strategies_array CHECK (jsonb_typeof(strategies) = 'array'),
  CONSTRAINT investor_profiles_regions_array CHECK (jsonb_typeof(regions) = 'array'),
  CONSTRAINT investor_profiles_property_types_array CHECK (jsonb_typeof(property_types) = 'array'),
  CONSTRAINT investor_profiles_risk_tolerance_check
    CHECK (risk_tolerance IN ('conservative', 'balanced', 'opportunistic')),
  CONSTRAINT investor_profiles_renovation_capacity_check
    CHECK (renovation_capacity IN ('low', 'medium', 'high'))
);

CREATE TABLE IF NOT EXISTS investor_analysis_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES zvg_listings(id) ON DELETE CASCADE,
  source_analysis_id uuid REFERENCES zvg_ki_analyses(id) ON DELETE SET NULL,
  quality_rules_version text NOT NULL,
  underwriting_version text NOT NULL,
  prompt_version text,
  model_used text,
  status text NOT NULL,
  input_snapshot jsonb NOT NULL,
  output_snapshot jsonb NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT investor_analysis_versions_source_analysis_unique UNIQUE (source_analysis_id)
);
CREATE INDEX IF NOT EXISTS idx_investor_analysis_versions_listing_generated
  ON investor_analysis_versions (listing_id, generated_at DESC);

CREATE TABLE IF NOT EXISTS investor_evaluation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quality_rules_version text NOT NULL,
  underwriting_version text NOT NULL,
  dataset_version text NOT NULL,
  sample_size integer NOT NULL,
  status text NOT NULL,
  metrics jsonb NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_investor_evaluation_runs_created
  ON investor_evaluation_runs (created_at DESC);

CREATE TABLE IF NOT EXISTS investor_analysis_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES zvg_listings(id) ON DELETE CASCADE,
  verdict text NOT NULL CHECK (verdict IN ('useful', 'not_useful', 'unclear')),
  strategy text,
  comment text,
  analysis_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT investor_feedback_user_listing_version_unique
    UNIQUE (user_id, listing_id, analysis_version)
);
CREATE INDEX IF NOT EXISTS idx_investor_analysis_feedback_listing
  ON investor_analysis_feedback (listing_id);

CREATE TABLE IF NOT EXISTS investor_deal_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES zvg_listings(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('watching', 'bid', 'acquired', 'rejected', 'sold')),
  strategy text,
  actual_bid_eur integer,
  actual_purchase_price_eur integer,
  actual_renovation_eur integer,
  actual_monthly_rent_eur integer,
  actual_sale_price_eur integer,
  notes text,
  occurred_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT investor_deal_outcomes_user_listing_unique UNIQUE (user_id, listing_id)
);
CREATE INDEX IF NOT EXISTS idx_investor_deal_outcomes_status
  ON investor_deal_outcomes (status);

COMMENT ON TABLE investor_analysis_versions IS
  'Unveränderliche Snapshots für reproduzierbare Investor-Memos und Regressionen.';
COMMENT ON TABLE investor_evaluation_runs IS
  'Versionierte Offline-/Shadow-Evaluationen der Qualitäts- und Underwriting-Regeln.';
COMMENT ON TABLE investor_deal_outcomes IS
  'Reale Nutzer-Outcomes zur späteren Kalibrierung; niemals ungeprüft als Modell-Label verwenden.';

-- Einmaliger, idempotenter Snapshot der vorhandenen KI-Analysen. Dadurch ist
-- der Zustand vor dem Overhaul reproduzierbar, ohne bestehende Tabellen oder
-- die laufende Scraper-Pipeline zu verändern.
INSERT INTO investor_analysis_versions (
  listing_id,
  source_analysis_id,
  quality_rules_version,
  underwriting_version,
  prompt_version,
  model_used,
  status,
  input_snapshot,
  output_snapshot,
  generated_at
)
SELECT
  l.id,
  a.id,
  'legacy-pre-p0',
  'legacy-pre-p0',
  NULL,
  a.model_used,
  'legacy_import',
  jsonb_build_object(
    'verkehrswert', l.verkehrswert,
    'wohnflaeche_m2', l.wohnflaeche_m2,
    'termin_date', l.termin_date,
    'needs_review', l.needs_review,
    'data_quality_flags', l.data_quality_flags
  ),
  jsonb_build_object(
    'investment_score', a.investment_score,
    'investment_score_begruendung', a.investment_score_begruendung,
    'moegliche_kaltmiete', a.moegliche_kaltmiete,
    'hausgeld', a.hausgeld,
    'arv_min_eur', a.arv_min_eur,
    'arv_max_eur', a.arv_max_eur,
    'arv_konfidenz', a.arv_konfidenz,
    'flip_roi_pct_min', a.flip_roi_pct_min,
    'flip_roi_pct_max', a.flip_roi_pct_max
  ),
  COALESCE(a.analyzed_at, NOW())
FROM zvg_ki_analyses a
JOIN zvg_listings l ON l.id = a.listing_id
ON CONFLICT (source_analysis_id) DO NOTHING;
