from pathlib import Path

from src.api.app import (
    _analysis_peek_metadata,
    _apply_angebot_abgleich,
    _merge_bilder,
    _without_purchase_underwriting,
)
from src.models.real_estate import CustomListingExtraction, CustomMarketAnalyse
from src.utils.content_price import (
    PREIS_REGEX,
    abgleich_angebot_extraktion,
    parse_euro_amount,
)


def test_analysis_peek_metadata_follows_content_mode():
    assert _analysis_peek_metadata("html", None) == {"fetch_source": "manual_html"}
    assert _analysis_peek_metadata("pdf", None) == {"fetch_source": "manual_pdf"}
    assert _analysis_peek_metadata("live", None) == {"fetch_source": "http"}
    assert _analysis_peek_metadata("live", "sid=1") == {
        "fetch_source": "http",
        "session_cookie_used": True,
    }


def test_parse_euro_amount_accepts_de_at_ch_separators():
    assert parse_euro_amount("198.000 €") == 198_000
    assert parse_euro_amount("198.000,00 EUR") == 198_000
    assert parse_euro_amount("198'000 €") == 198_000
    assert parse_euro_amount("198 000 €") == 198_000
    assert parse_euro_amount("890 €") == 890
    assert parse_euro_amount("1.250 €") == 1_250


def test_preis_regex_requires_euro_not_chf():
    assert PREIS_REGEX.search("890'000 CHF") is None
    assert PREIS_REGEX.search("198.000 €") is not None
    assert parse_euro_amount("kein Preis") is None


def test_custom_url_skips_flip_deal_unless_kauf():
    app = (Path(__file__).resolve().parents[1] / "src/api/app.py").read_text()
    assert 'is_kauf = angebotstyp == "kauf"' in app
    assert "persisted_angebotstyp or extraction.angebotstyp" in app
    assert (
        "RETURNING id, angebotstyp"
        in (Path(__file__).resolve().parents[1] / "src/storage/real_estate.py").read_text()
    )
    assert "if not is_kauf:" in app
    assert "analyse = _without_purchase_underwriting(analyse)" in app
    assert "if not is_kauf:" in app
    assert "Mietangebot · keine Kauf-Rechnung" in app
    assert "elif analyse.fix_flip_massnahmen:" in app
    assert "if is_kauf and analyse.fix_flip_massnahmen:" not in app
    assert "len(images) != len(limited)" in app
    assert "bestehende Galerie" in app
    assert "hatte noch keine Fotos" in app
    assert "if existing > 0:" in app
    assert "def _image_dedup_key(url: str) -> str:" in app
    assert "merged.append(raw)" in app
    assert '"angebotstyp": extraction.angebotstyp' in app
    assert 'if angebotstyp == "miete":' in app
    assert "Kaltmiete EUR/Monat" in app
    assert "_extract_preis_fallback(page.raw_html, extraction.angebotstyp)" in app
    assert "_apply_angebot_abgleich(" in app
    assert "peek_existing_real_estate_state(" in app
    assert (
        "stored_typ, previous_loc, existing_listing_id = await peek_existing_real_estate_state("
        in app
    )
    assert (
        "expected_listing_id=expected_listing_id"
        in app[
            app.index("peek_meta = _analysis_peek_metadata") : app.index(
                "gone = await _fail_if_refresh_target_gone("
            )
        ]
    )
    assert "_analysis_peek_metadata(" in app
    assert "listing_id=existing_listing_id" in app
    ladder = (Path(__file__).resolve().parents[1] / "src/utils/scrape_ladder.py").read_text()
    assert "def body_has_expose(" in ladder
    assert "def login_wall_without_expose(" in ladder
    assert "login_only = login_wall_without_expose(markdown, raw_html)" in ladder
    assert "persist_custom_url_listing_and_ki(" in app
    assert "expected_listing_id=expected_listing_id" in app
    assert 'job_expected_listing_id(claimed.get("listing_id"))' in app
    assert "async def _fail_if_refresh_target_gone(" in app
    assert 'error_code="LISTING_GONE"' in app
    assert app.index("_analysis_peek_metadata(") < app.index("fetch_page_resilient(")
    assert app.index("listing_id=existing_listing_id") < app.index('step="extracting"')
    assert 'existing_listing_id and extraction.seiteninhalt_erkannt != "immobilienangebot"' in app
    assert app.index("Refresh abgebrochen: kein belastbares Exposé") < app.index(
        "_analyze_market_fairness, extraction"
    )
    assert app.index("_analyze_market_fairness, extraction") < app.index(
        "persist_custom_url_listing_and_ki("
    )
    market = app[app.index('step="market"') : app.index('step="investment"')]
    assert "listing_id" not in market
    assert app.index("rejected_flip = _apply_angebot_abgleich(") < app.index(
        "if extraction.preis is None and page.raw_html and not rejected_flip:"
    )
    assert "await replace_real_estate_images(listing_id, images)" in app
    assert "await update_cover_image_url" not in app
    assert "nur_beschriftet=False" in app
    assert "nie Jahreskaltmiete" in app
    storage = (Path(__file__).resolve().parents[1] / "src/storage/real_estate.py").read_text()
    assert "ELSE COALESCE(real_estate_listings.angebotstyp, EXCLUDED.angebotstyp)" in storage
    assert "THEN real_estate_listings.preis" in storage
    assert "ELSE COALESCE(EXCLUDED.preis, real_estate_listings.preis)" in storage
    assert "AND EXCLUDED.angebotstyp = 'miete'\n                  THEN EXCLUDED.preis" in storage
    assert "THEN real_estate_listings.kaltmiete_eur" in storage
    assert "THEN COALESCE(NULLIF(EXCLUDED.kaltmiete_eur, 0), EXCLUDED.preis)" in storage
    kalt = storage[storage.index("kaltmiete_eur = CASE") : storage.index("zustand_kurz = COALESCE")]
    assert "OR (EXCLUDED.angebotstyp = 'kauf' AND EXCLUDED.preis IS NOT NULL)" in kalt
    assert "THEN NULLIF(EXCLUDED.kaltmiete_eur, 0)" in kalt
    assert "EXCLUDED.angebotstyp = 'kauf' AND EXCLUDED.preis IS NOT NULL" in storage
    assert "EXCLUDED.preis IS NOT NULL OR EXCLUDED.kaltmiete_eur IS NOT NULL" in storage
    assert "hausgeld_eur = _positive_or_none(extraction.hausgeld_eur)" in storage
    assert "kaltmiete_eur = _positive_or_none(extraction.kaltmiete_eur)" in storage
    assert "endenergiebedarf_kwh = _positive_or_none(extraction.endenergiebedarf_kwh)" in storage
    assert "WHEN real_estate_listings.denkmalschutz IS TRUE THEN TRUE" in storage
    assert "WHEN real_estate_listings.vermietet IS TRUE THEN TRUE" in storage
    assert "wohnflaeche_m2 = COALESCE(NULLIF(EXCLUDED.wohnflaeche_m2, 0)" in storage
    assert "preis_pro_m2 = CASE" in storage
    assert "THEN real_estate_listings.preis_pro_m2" in storage
    assert "raw_data = COALESCE(real_estate_listings.raw_data" in storage
    assert "if not images:" in storage
    slicer = (Path(__file__).resolve().parents[1] / "src/utils/content_slicer.py").read_text()
    assert "preiszeile_aus_text(text, nur_beschriftet=False)" in slicer
    assert "_json_ld_is_rent" in slicer
    market = (Path(__file__).resolve().parents[1] / "src/storage/market.py").read_text()
    assert "EXCLUDED.angebotstyp IS DISTINCT FROM market_comparables.angebotstyp" in market
    assert "THEN market_comparables.preis_eur" in market
    assert "ELSE COALESCE(NULLIF(EXCLUDED.preis_eur, 0), market_comparables.preis_eur)" in market
    assert "THEN market_comparables.preis_pro_m2" in market
    assert "THEN market_comparables.zuletzt_gesehen_am" in market
    assert "THEN market_comparables.ist_aktiv" in market
    assert "alt.angebotstyp AS alt_angebotstyp" in market
    assert "alt_typ == angebot.angebotstyp" in market
    assert "wohnflaeche_m2 = COALESCE(NULLIF(EXCLUDED.wohnflaeche_m2, 0)" not in market
    assert (
        "ELSE COALESCE(NULLIF(EXCLUDED.wohnflaeche_m2, 0), market_comparables.wohnflaeche_m2)"
        in market
    )
    assert "priceCurrency" in slicer
    assert "_json_ld_items" in slicer
    assert "_JSON_LD_ADDON_NAME" in slicer
    model = (Path(__file__).resolve().parents[1] / "src/models/real_estate.py").read_text()
    assert "NUR bei angebotstyp='kauf' mit erkennbarer Vermietbarkeit" in model
    assert "NUR bei Mietobjekten relevant" not in model


def test_without_purchase_underwriting_clears_investor_fields():
    analyse = CustomMarketAnalyse(
        zusammenfassung="ok",
        investment_score="attraktiv",
        investment_score_begruendung="hohe Rendite",
        rendite_geschaetzt_pct=8,
        cashflow_einschaetzung="positiv",
        risiken_investor=["Leerstand"],
        jahresrohertrag=12_000,
        liegenschaftszinssatz=4,
        ertragswert=200_000,
    )
    cleared = _without_purchase_underwriting(analyse)
    assert cleared.rendite_geschaetzt_pct is None
    assert cleared.investment_score is None
    assert cleared.investment_score_begruendung is None
    assert cleared.cashflow_einschaetzung is None
    assert cleared.risiken_investor == []
    assert cleared.fix_flip_massnahmen == []
    assert cleared.jahresrohertrag is None
    assert cleared.liegenschaftszinssatz is None
    assert cleared.ertragswert is None
    assert cleared.zusammenfassung == "ok"


def test_merge_bilder_keeps_query_and_dedups_path():
    merged = _merge_bilder(
        ["https://cdn.example/a.jpg?token=1"],
        ["https://cdn.example/a.jpg?w=800", "https://cdn.example/b.jpg"],
    )
    assert merged == [
        "https://cdn.example/a.jpg?token=1",
        "https://cdn.example/b.jpg",
    ]


def test_abgleich_angebot_extraktion_blocks_unproven_llm_flip():
    assert abgleich_angebot_extraktion("kauf", "miete", 250_000, "Wohnung zentral") == (
        "kauf",
        None,
    )
    assert abgleich_angebot_extraktion("kauf", "miete", 250_000, "Kaltmiete 850 €") == (
        "miete",
        850,
    )
    assert abgleich_angebot_extraktion("miete", "kauf", 850, "Kaufpreis 250.000 €") == (
        "kauf",
        250_000,
    )
    assert abgleich_angebot_extraktion("kauf", "miete", 250_000, "Kaltmiete") == (
        "kauf",
        None,
    )
    assert abgleich_angebot_extraktion(None, "miete", 850, "Kaufpreis 250.000 €") == (
        "kauf",
        250_000,
    )
    assert abgleich_angebot_extraktion(None, "miete", 850, "Wohnung zentral") == (
        "miete",
        850,
    )
    assert abgleich_angebot_extraktion("kauf", "kauf", 260_000, "Kaufpreis 260.000 €") == (
        "kauf",
        260_000,
    )


def test_apply_angebot_abgleich_wipes_kaltmiete_on_proven_kauf_flip():
    extraction = CustomListingExtraction(
        angebotstyp="kauf",
        preis=250_000,
        kaltmiete_eur=850,
    )
    assert _apply_angebot_abgleich(extraction, "miete", "Kaufpreis 250.000 €") is False
    assert extraction.angebotstyp == "kauf"
    assert extraction.preis == 250_000
    assert extraction.kaltmiete_eur is None

    rent = CustomListingExtraction(angebotstyp="miete", preis=250_000)
    assert _apply_angebot_abgleich(rent, "kauf", "Kaltmiete 850 €") is False
    assert rent.angebotstyp == "miete"
    assert rent.preis == 850
    assert rent.kaltmiete_eur == 850

    rejected = CustomListingExtraction(angebotstyp="miete", preis=850)
    assert _apply_angebot_abgleich(rejected, "kauf", "Wohnung zentral") is True
    assert rejected.angebotstyp == "kauf"
    assert rejected.preis is None


def test_custom_url_skips_price_fallback_after_rejected_flip():
    app = (Path(__file__).resolve().parents[1] / "src/api/app.py").read_text()
    assert "rejected_flip = _apply_angebot_abgleich(" in app
    assert "if extraction.preis is None and page.raw_html and not rejected_flip:" in app
