from pathlib import Path

from src.storage.real_estate import (
    _blank_to_none,
    _positive_or_none,
    job_expected_listing_id,
    refresh_target_gone,
)
from src.storage.listing_scope import (
    blocks_cross_user_private_update,
    listing_external_id,
    listing_url_host_variants,
    listing_url_identity,
    listing_url_identity_base,
    listing_url_leftover_prefixes,
    listing_url_lookup_variants,
    owner_scoped_external_id,
    raw_data_is_private,
    scrape_metadata_is_private,
    strip_listing_identity_query,
)


def test_private_metadata_and_raw_data():
    assert scrape_metadata_is_private(None) is True
    assert scrape_metadata_is_private({}) is True
    assert scrape_metadata_is_private({"fetch_source": "http"}) is False
    assert scrape_metadata_is_private({"fetch_source": "unknown"}) is True
    assert scrape_metadata_is_private({"session_cookie_used": True}) is True
    assert scrape_metadata_is_private({"session_cookie_used": 1}) is True
    assert scrape_metadata_is_private({"session_cookie_used": "TRUE"}) is True
    assert (
        scrape_metadata_is_private({"fetch_source": "http", "session_cookie_used": "True"}) is True
    )
    assert scrape_metadata_is_private({"fetch_source": "manual_html"}) is True
    assert raw_data_is_private({"scrape_metadata": {"fetch_source": "manual_pdf"}}) is True
    assert raw_data_is_private('{"scrape_metadata":{"session_cookie_used":true}}') is True
    assert (
        raw_data_is_private(
            {"scrape_metadata": {"fetch_source": "http"}},
            "https://manuelle-eingabe.immopulse/html/abc",
        )
        is True
    )


def test_listing_url_host_variants_collapse_www():
    apex = "https://immobilienscout24.de/expose/123"
    www = "https://www.immobilienscout24.de/expose/123"
    assert listing_url_identity(www) == apex
    assert listing_url_identity(apex) == apex
    assert listing_url_host_variants(www) == [apex, www]
    assert listing_url_host_variants(apex) == [apex, www]
    scoped = listing_url_host_variants(f"{www}#owner:u1")
    assert scoped[0] == f"{apex}#owner:u1"
    assert scoped[1] == f"{www}#owner:u1"


def test_listing_url_identity_strips_tracking_and_portal_query():
    expose = "https://www.immobilienscout24.de/expose/123?referrer=share&searchId=9&keep=1"
    assert listing_url_identity(expose) == "https://immobilienscout24.de/expose/123"
    dirty = "https://www.kleinanzeigen.de/s-anzeige/wohnung/123?utm_source=share&fbclid=abc"
    clean = "https://kleinanzeigen.de/s-anzeige/wohnung/123"
    assert strip_listing_identity_query(dirty).endswith("/s-anzeige/wohnung/123")
    assert listing_url_identity(dirty) == clean
    assert listing_external_id(dirty, "u1", {"fetch_source": "http"}) == clean
    lookup = listing_url_lookup_variants(dirty)
    assert clean in lookup
    assert (
        "https://www.kleinanzeigen.de/s-anzeige/wohnung/123?utm_source=share&fbclid=abc" in lookup
    )
    other = "https://makler.example/objekt/1?utm_campaign=mail&id=9"
    assert listing_url_identity(other) == "https://makler.example/objekt/1?id=9"
    fragment = "https://www.makler.example/objekt/1#galerie"
    assert listing_url_identity(fragment) == "https://makler.example/objekt/1"
    assert listing_url_identity("https://makler.example/objekt/1?id=9#tab") == (
        "https://makler.example/objekt/1?id=9"
    )
    assert listing_url_identity_base(fragment) == "https://makler.example/objekt/1"
    assert listing_url_identity_base("https://makler.example/objekt/1#galerie") == (
        listing_url_identity_base("https://makler.example/objekt/1")
    )
    assert listing_url_identity_base(dirty) == clean
    prefixes = listing_url_leftover_prefixes(dirty)
    assert "https://kleinanzeigen.de/s-anzeige/wohnung/123" in prefixes
    assert "https://www.kleinanzeigen.de/s-anzeige/wohnung/123" in prefixes
    leftover = "https://makler.example/objekt/1#galerie"
    assert listing_url_identity_base(leftover) == listing_url_identity_base(
        "https://makler.example/objekt/1"
    )
    assert "https://makler.example/objekt/1" in listing_url_leftover_prefixes(leftover)
    assert all("#" not in variant for variant in listing_url_host_variants(leftover))


def test_external_id_is_owner_scoped_for_private_scrapes():
    url = "https://portal.de/x"
    assert listing_external_id(url, "u1", {"fetch_source": "http"}) == url
    assert listing_external_id(url, "u1", None) == f"{url}#owner:u1"
    assert listing_external_id(url, "u1", {"session_cookie_used": True}) == f"{url}#owner:u1"
    assert listing_external_id(url, None, {"session_cookie_used": True}) == f"{url}#owner:system"
    manual = "https://manuelle-eingabe.immopulse/html/abc"
    assert listing_external_id(manual, "u1", {"fetch_source": "http"}) == f"{manual}#owner:u1"


def test_blocks_cross_user_private_but_allows_same_user_and_public():
    private = {"scrape_metadata": {"session_cookie_used": True}}
    public = {"scrape_metadata": {"fetch_source": "http"}}
    assert blocks_cross_user_private_update("a", private, "b", None) is True
    assert blocks_cross_user_private_update("a", public, "b", {"session_cookie_used": True}) is True
    assert blocks_cross_user_private_update("a", public, "a", {"session_cookie_used": True}) is True
    assert blocks_cross_user_private_update("a", private, "a", {"fetch_source": "http"}) is True
    assert blocks_cross_user_private_update("a", private, None, {"fetch_source": "http"}) is True
    assert blocks_cross_user_private_update("a", public, "a", {"fetch_source": "http"}) is False
    assert (
        blocks_cross_user_private_update("a", private, "a", {"session_cookie_used": True}) is False
    )
    assert blocks_cross_user_private_update("a", public, "b", {"fetch_source": "http"}) is False
    assert blocks_cross_user_private_update("a", private, None, None) is True
    assert (
        blocks_cross_user_private_update(
            "a",
            public,
            "b",
            {"fetch_source": "http"},
            "https://manuelle-eingabe.immopulse/html/abc",
        )
        is True
    )
    assert owner_scoped_external_id("https://x", None) == "https://x#owner:system"


def test_blank_and_zero_fields_are_absent():
    assert _blank_to_none("") is None
    assert _blank_to_none("   ") is None
    assert _blank_to_none(" Köln ") == "Köln"
    assert _positive_or_none(0) is None
    assert _positive_or_none(0.0) is None
    assert _positive_or_none(-3) is None
    assert _positive_or_none(72.5) == 72.5


def test_refresh_candidates_require_public_live_source():
    src = (Path(__file__).resolve().parents[1] / "src/storage/real_estate.py").read_text()
    assert "IN ('http', 'scrapling')" in src
    assert "NOT IN ('manual_html', 'manual_pdf')" not in src
    assert "lower(COALESCE(raw_data#>>'{scrape_metadata,session_cookie_used}', ''))" in src
    assert 'raw_data["scrape_metadata"] = stored_meta' in src
    assert "source_url NOT LIKE $3" in src
    assert "MANUAL_UPLOAD_HOST" in src
    assert 'existing["source_url"]' in src
    assert "ELSE COALESCE(real_estate_listings.angebotstyp, EXCLUDED.angebotstyp)" in src
    assert "RETURNING id, angebotstyp" in src
    assert "THEN real_estate_listings.preis" in src
    assert "ELSE COALESCE(EXCLUDED.preis, real_estate_listings.preis)" in src
    assert "THEN EXCLUDED.preis" in src
    assert "THEN real_estate_listings.kaltmiete_eur" in src
    assert "THEN COALESCE(NULLIF(EXCLUDED.kaltmiete_eur, 0), EXCLUDED.preis)" in src
    kalt = src[src.index("kaltmiete_eur = CASE") : src.index("zustand_kurz = COALESCE")]
    assert "OR (EXCLUDED.angebotstyp = 'kauf' AND EXCLUDED.preis IS NOT NULL)" in kalt
    assert "THEN NULLIF(EXCLUDED.kaltmiete_eur, 0)" in kalt
    assert "THEN real_estate_listings.preis_pro_m2" in src
    assert "EXCLUDED.angebotstyp = 'kauf' AND EXCLUDED.preis IS NOT NULL" in src
    assert "EXCLUDED.preis IS NOT NULL OR EXCLUDED.kaltmiete_eur IS NOT NULL" in src
    assert "WHEN real_estate_listings.denkmalschutz IS TRUE THEN TRUE" in src
    assert "wohnflaeche_m2 = COALESCE(NULLIF(EXCLUDED.wohnflaeche_m2, 0)" in src
    assert "adresse = CASE" in src
    assert "THEN NULLIF(BTRIM(EXCLUDED.adresse), '')" in src
    assert "ort = CASE" in src
    assert "AND NULLIF(BTRIM(real_estate_listings.plz), '') IS NOT NULL" in src
    assert "AND NULLIF(BTRIM(real_estate_listings.ort), '') IS NOT NULL" in src
    assert "AND NULLIF(BTRIM(EXCLUDED.ort), '') IS NULL" in src
    assert "ELSE COALESCE(NULLIF(BTRIM(EXCLUDED.ort), ''), real_estate_listings.ort)" in src
    assert "preis_pro_m2 = CASE" in src
    assert "raw_data = COALESCE(real_estate_listings.raw_data" in src
    assert "if not images:" in src
    assert "if stored_meta:" in src
    assert "beschreibung = _blank_to_none(extraction.beschreibung)" in src
    assert "SELECT id, external_id, source, submitted_by_user_id, raw_data, source_url," in src
    assert "adresse, plz, ort, angebotstyp" in src
    assert "async def _resolve_listing_row(" in src
    assert "listing_url_lookup_variants(" in src
    assert "async def _load_existing_listing_by_id(" in src
    assert "async def _load_existing_listings_matching_identity(" in src
    assert "LIKE ANY($2::text[]) ESCAPE" not in src
    assert "FROM unnest($2::text[]) AS pat" in src
    assert "external_id LIKE pat ESCAPE" in src
    assert "source_url LIKE pat ESCAPE" in src
    assert "async def _maybe_canonicalize_listing_identity(" in src
    assert (
        "expected_listing_id=expected_listing_id"
        in src[
            src.index("async def peek_existing_real_estate_state") : src.index(
                "async def peek_existing_real_estate_angebotstyp"
            )
        ]
    )
    assert (
        "expected_listing_id: Optional[str] = None"
        in src[
            src.index("async def _resolve_listing_row") : src.index(
                "async def peek_existing_real_estate_state"
            )
        ]
    )
    assert 'f"re-listing:{listing_url_identity(source_url)}"' in src
    assert "owner_scoped_external_id(cand_url, user_id)" in src
    assert "async def peek_existing_real_estate_state(" in src
    assert "async def peek_existing_real_estate_angebotstyp(" in src
    assert 'str(existing["id"])' in src
    assert "return None, None, None" in src
    assert "typ, _previous, _listing_id = await peek_existing_real_estate_state(" in src
    assert "async def persist_custom_url_listing_and_ki(" in src
    persist = src[src.index("async def persist_custom_url_listing_and_ki") :]
    assert persist.index("_upsert_real_estate_listing_on_conn(") < persist.index(
        "_insert_real_estate_ki_analyse_on_conn("
    )
    assert "expected_listing_id: Optional[str] = None" in persist
    assert "if refresh_target_gone(existing_id, expected_listing_id):" in src
    assert "raise RealEstateListingGoneError(expected_listing_id)" in src
    assert "async def custom_listing_exists(" in src
    assert (
        "SET lat = NULL, lng = NULL"
        in persist[: persist.index("async def count_real_estate_images")]
    )
    assert "SET cover_image_url = $2" in src[src.index("async def replace_real_estate_images") :]
    assert "return listing_id, previous, persisted_angebotstyp" in src
    assert "ist_aktiv = CASE" in src
    assert "ELSE real_estate_listings.ist_aktiv" in src
    assert "NOT LIKE $31" in src
    assert 'f"%//{MANUAL_UPLOAD_HOST}/%"' in src
    assert "ist_aktiv = TRUE" not in src.split("RETURNING id")[0]


def test_refresh_target_gone_blocks_insert_without_expected_row():
    assert refresh_target_gone(None, None) is False
    assert refresh_target_gone("abc", None) is False
    assert refresh_target_gone("abc", "") is False
    assert refresh_target_gone("abc", "abc") is False
    assert refresh_target_gone(None, "abc") is True
    assert refresh_target_gone("other", "abc") is True


def test_identity_lookup_sql_is_valid_postgres_like():
    from src.storage.real_estate import _EXISTING_LISTING_BY_IDENTITY_SQL, _like_literal

    assert "LIKE ANY($2::text[]) ESCAPE" not in _EXISTING_LISTING_BY_IDENTITY_SQL
    assert "unnest($2::text[]) AS pat" in _EXISTING_LISTING_BY_IDENTITY_SQL
    assert _like_literal("a_%b") == "a\\_\\%b"


def test_job_expected_listing_id_from_claimed_row():
    assert job_expected_listing_id(None) is None
    assert job_expected_listing_id("") is None
    assert job_expected_listing_id("  ") is None
    assert job_expected_listing_id("abc") == "abc"
    assert (
        "RETURNING id, user_id, url, listing_id"
        in (Path(__file__).resolve().parents[1] / "src/storage/real_estate.py").read_text()
    )
