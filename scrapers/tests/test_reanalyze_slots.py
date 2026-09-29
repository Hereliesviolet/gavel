from pathlib import Path


def test_custom_url_reanalysis_uses_shared_system_slot():
    src = (Path(__file__).resolve().parents[1] / "src/flows/reanalyze_investment.py").read_text()
    assert "try_claim_shared_slot" in src
    assert "release_shared_slot" in src
    assert "run_custom_url_reanalysis" in src
    assert "MAX_CONCURRENT_SYSTEM_ANALYSES" in src
    assert src.index("claim_system_analyse_slot") < src.index("log_request=False")
    assert "expected_listing_id=expected_listing_id" in src
    assert "custom_listing_exists(listing_id)" in src
    assert "übersprungen: Listing gelöscht" in src
    app = (Path(__file__).resolve().parents[1] / "src/api/app.py").read_text()
    assert "_LOG_CUSTOM_URL_REQUEST" in app
    assert "log_request: bool = True" in app
    assert "async def _upload_and_store_images(listing_id: str, bilder: list[str]) -> int:" in app
    assert 'await _detail(f"{stored} Fotos gespeichert")' in app
    assert 'await _detail("Keine Fotos gespeichert · Galerie unverändert")' in app
    assert "count_real_estate_images" in app
    assert 'preview_base["bildCount"] = await count_real_estate_images(listing_id)' in app
    assert 'preview_base["bildCount"] = stored' not in app
    assert 'preview_base["bildCount"] = 0' not in app
    assert 'await _detail(f"{n_bilder} Fotos gespeichert")' not in app
