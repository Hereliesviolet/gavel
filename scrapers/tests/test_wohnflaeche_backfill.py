from pathlib import Path


def test_kandidaten_skippen_persistierte_fehlversuche() -> None:
    src = (Path(__file__).resolve().parents[1] / "backfill_wohnflaeche.py").read_text()
    assert "TERMINAL_WOHNFLAECHE_SKIPS" in src
    assert "gutachten_kostenpflichtig" in src
    assert "scan_ohne_befund" in src
    assert "kein_pdf" in src
    assert "COALESCE(raw_data->>'wohnflaeche_skip', '') = ''" in src
    assert "jsonb_build_object('wohnflaeche_skip', $2::text)" in src
    assert "raw_data = COALESCE(raw_data, '{}'::jsonb) - 'wohnflaeche_skip'" in src
    assert "quelle in TERMINAL_WOHNFLAECHE_SKIPS" in src
