-- investor_analysis_versions enthielt ausschliesslich einen einmaligen
-- Legacy-Import vom 2026-07-24; seither schreibt kein Flow und liest keine
-- Oberflaeche. Die Versionierung, die tatsaechlich zaehlt, steht in
-- investor_evaluation_runs (Regel- und Underwriting-Version je Lauf).
DROP TABLE IF EXISTS investor_analysis_versions;
