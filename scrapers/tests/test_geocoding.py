from decimal import Decimal
from pathlib import Path

from src.storage.postgres import storage_path_from_public_url
from src.utils.geocoding import (
    HAS_GEOCODEABLE_LOCATION_SQL,
    coherent_location,
    is_usable_geo_point,
    location_identity,
    nominatim_search_query,
    normalize_location_city,
    parse_usable_geo_point,
)


def test_usable_geo_point_rejects_null_island_and_non_finite():
    assert is_usable_geo_point(48.137, 11.575) is True
    assert is_usable_geo_point(0, 0) is False
    assert is_usable_geo_point(0.0, 0.0) is False
    assert is_usable_geo_point(float("nan"), 11.5) is False
    assert is_usable_geo_point(48.1, float("inf")) is False
    assert is_usable_geo_point("48.1", "11.5") is False
    assert is_usable_geo_point(True, False) is False


def test_parse_usable_geo_point_coerces_strings_and_decimals():
    assert parse_usable_geo_point("48.1", "11.5") == (48.1, 11.5)
    assert parse_usable_geo_point(Decimal("48.137"), Decimal("11.575")) == (48.137, 11.575)
    assert parse_usable_geo_point("0.0000000", "0.0000000") is None
    assert parse_usable_geo_point(Decimal("0"), Decimal("0")) is None
    assert parse_usable_geo_point(True, False) is None
    assert parse_usable_geo_point(None, 11.5) is None


def test_nominatim_search_query_scopes_country():
    assert (
        nominatim_search_query("Harderstraße 21, 89250, Senden")
        == "Harderstraße 21, 89250, Senden, Deutschland"
    )
    assert nominatim_search_query(None, "1010", "Wien", country_label=None) == "1010 Wien"
    assert (
        nominatim_search_query("Hauptstraße 1, 1010 Wien", country_label=None)
        == "Hauptstraße 1, 1010 Wien"
    )
    assert nominatim_search_query(None, None, None, country_label=None) == ""
    assert nominatim_search_query(None, "80331", "München") == "80331 München, Deutschland"
    assert "NULLIF(BTRIM(ort), '') IS NOT NULL" in HAS_GEOCODEABLE_LOCATION_SQL


def test_location_identity_normalizes_and_app_clears_stale_geo():
    assert location_identity(" München ", "80331", "München") == (
        "münchen",
        "80331",
        "muenchen",
    )
    assert location_identity("Hamburg", "20095", "Hamburg") != location_identity(
        "München", "80331", "München"
    )
    assert normalize_location_city("München") == normalize_location_city("Muenchen")
    app = (Path(__file__).resolve().parents[1] / "src/api/app.py").read_text()
    storage = (Path(__file__).resolve().parents[1] / "src/storage/real_estate.py").read_text()
    assert "clear_geo = True" in app
    assert "location_identity(*previous_loc)" in app
    assert "coherent_location(" in app
    assert "or (previous_loc[0] if previous_loc else None)" not in app
    assert "persist_custom_url_listing_and_ki(" in app
    assert "clear_geo=clear_geo" in app
    assert "SET lat = NULL, lng = NULL" in storage
    except_idx = app.find("Custom-URL-Geocoding fehlgeschlagen")
    assert except_idx != -1
    except_block = app[except_idx : except_idx + 700]
    assert "clear_geo = True" in except_block
    assert "location_identity(*previous_loc)" in except_block


def test_coherent_location_does_not_mix_cities():
    assert coherent_location(
        (None, None, "Hamburg"),
        ("Unter den Linden 1", "10117", "Berlin"),
    ) == (None, None, "Hamburg")
    assert coherent_location(
        (None, None, "Muenchen"),
        ("Marienplatz 1", "80331", "München"),
    ) == ("Marienplatz 1", "80331", "Muenchen")
    assert coherent_location(
        (None, "20095", "Hamburg"),
        ("Reeperbahn 1", "20359", "Hamburg"),
    ) == (None, "20095", "Hamburg")
    assert coherent_location(
        (None, None, None),
        ("Unter den Linden 1", "10117", "Berlin"),
    ) == ("Unter den Linden 1", "10117", "Berlin")
    assert coherent_location((None, None, "Köln"), None) == (None, None, "Köln")
    assert coherent_location(
        (None, None, "München"),
        ("Marienplatz 1", "80331", None),
    ) == ("Marienplatz 1", "80331", "München")
    assert coherent_location(
        (None, "20095", "München"),
        ("Marienplatz 1", "80331", None),
    ) == (None, "20095", "München")
    assert coherent_location(
        (None, "80331", None),
        ("Unter den Linden 1", "10117", "Berlin"),
    ) == (None, "80331", None)
    assert coherent_location(
        ("Marienplatz 1", "80331", None),
        ("Unter den Linden 1", "10117", "Berlin"),
    ) == ("Marienplatz 1", "80331", None)
    assert coherent_location(
        (None, "10117", None),
        ("Unter den Linden 1", None, "Berlin"),
    ) == ("Unter den Linden 1", "10117", "Berlin")
    storage = (Path(__file__).resolve().parents[1] / "src/storage/real_estate.py").read_text()
    loc = storage[storage.index("adresse = CASE") : storage.index("preis = CASE")]
    assert "LOWER(BTRIM(EXCLUDED.ort))" in loc
    assert "THEN NULLIF(BTRIM(EXCLUDED.adresse), '')" in loc
    assert "THEN NULLIF(BTRIM(EXCLUDED.plz), '')" in loc
    assert "NULLIF(BTRIM(real_estate_listings.ort), '') IS NOT NULL" in loc
    assert "NULLIF(BTRIM(real_estate_listings.plz), '') IS NOT NULL" in loc
    assert "BTRIM(EXCLUDED.plz) IS DISTINCT FROM BTRIM(real_estate_listings.plz)" in loc
    assert "ort = CASE" in loc
    assert "AND NULLIF(BTRIM(EXCLUDED.ort), '') IS NULL" in loc
    app = (Path(__file__).resolve().parents[1] / "src/api/app.py").read_text()
    assert "extraction.adresse = geo_adresse" in app
    assert "extraction.plz = geo_plz" in app
    assert "extraction.ort = geo_ort" in app


def test_custom_url_geocode_does_not_force_germany():
    app = (Path(__file__).resolve().parents[1] / "src/api/app.py").read_text()
    flow = (Path(__file__).resolve().parents[1] / "src/flows/geocoding.py").read_text()
    assert "countrycodes=None" in app
    assert "country_label=None" in app
    assert "countrycodes=None" not in flow
    assert "country_label=None" not in flow
    util = (Path(__file__).resolve().parents[1] / "src/utils/geocoding.py").read_text()
    assert 'countrycodes: str | None = "de"' in util
    assert "if countrycodes:" in util


def test_geocode_and_persist_guard_null_island():
    util = (Path(__file__).resolve().parents[1] / "src/utils/geocoding.py").read_text()
    storage = (Path(__file__).resolve().parents[1] / "src/storage/real_estate.py").read_text()
    flow = (Path(__file__).resolve().parents[1] / "src/flows/geocoding.py").read_text()
    backfill = (Path(__file__).resolve().parents[1] / "backfill_geocoding.py").read_text()
    postgres = (Path(__file__).resolve().parents[1] / "src/storage/postgres.py").read_text()
    ki = (Path(__file__).resolve().parents[1] / "src/flows/ki_analysis.py").read_text()
    assert "is_usable_geo_point(lat, lon)" in util
    assert "is_usable_geo_point(lat, lng)" in storage
    assert "is_usable_geo_point(coords[0], coords[1])" in flow
    assert "MISSING_OR_NULL_ISLAND_SQL" in flow
    assert "MISSING_OR_NULL_ISLAND_SQL" in backfill
    assert "HAS_GEOCODEABLE_LOCATION_SQL" in flow
    assert "HAS_GEOCODEABLE_LOCATION_SQL" in backfill
    assert "AND adresse IS NOT NULL" not in flow
    assert "AND adresse IS NOT NULL" not in backfill
    assert "NULLIF(BTRIM(ort), '') IS NOT NULL" in util
    assert "lat = 0 AND lng = 0" in util
    assert "parse_usable_geo_point(listing.lat, listing.lng)" in postgres
    assert 'parse_usable_geo_point(listing.get("lat"), listing.get("lng"))' in ki
    assert "COALESCE(($2::jsonb->>'arv_min_eur')::int, arv_min_eur)" in postgres
    assert "arv_min_eur = COALESCE($2, arv_min_eur)" in postgres
    assert "arv_max_eur = COALESCE($3, arv_max_eur)" in postgres
    assert "holding_monate = COALESCE($6, holding_monate)" in postgres
    assert "termin_date = COALESCE(EXCLUDED.termin_date, zvg_listings.termin_date)" in postgres
    assert (
        "direktlink = COALESCE(NULLIF(BTRIM(EXCLUDED.direktlink), ''), zvg_listings.direktlink)"
        in postgres
    )
    assert "ort = CASE" in postgres
    assert "AND NULLIF(BTRIM(zvg_listings.plz), '') IS NOT NULL" in postgres
    assert "AND NULLIF(BTRIM(EXCLUDED.ort), '') IS NULL" in postgres
    assert "ELSE COALESCE(NULLIF(BTRIM(EXCLUDED.ort), ''), zvg_listings.ort)" in postgres
    assert "adresse = CASE" in postgres
    assert "strasse = CASE" in postgres
    assert "zvg_listings.gutachten_url LIKE '%/zvg-images/%'" in postgres
    assert "zvg_listings.expose_url LIKE '%/zvg-images/%'" in postgres
    assert "THEN zvg_listings.gutachten_url" in postgres
    assert "THEN zvg_listings.expose_url" in postgres
    assert "THEN COALESCE(zvg_listings.raw_data, '{}'::jsonb) || EXCLUDED.raw_data" in postgres
    assert (
        "beschreibung = COALESCE(NULLIF(BTRIM(EXCLUDED.beschreibung), ''), zvg_listings.beschreibung)"
        in postgres
    )
    assert "async def replace_zvg_images" in postgres
    assert "async def persist_zvg_gallery" in postgres
    assert "len(images) != intended_count" in postgres
    assert "len(images) <= existing" in postgres
    assert "THEN EXCLUDED.lat" in postgres
    assert "THEN EXCLUDED.lng" in postgres
    assert "ELSE COALESCE(zvg_listings.lat, EXCLUDED.lat)" in postgres
    lat_case = postgres[postgres.index("lat = CASE") : postgres.index("lng = CASE")]
    assert "COALESCE(NULLIF(BTRIM(EXCLUDED.adresse), ''), zvg_listings.adresse)" not in lat_case
    assert "AND NULLIF(BTRIM(zvg_listings.adresse), '') IS NOT NULL" in lat_case
    assert "AND NULLIF(BTRIM(zvg_listings.plz), '') IS NOT NULL" in lat_case
    assert "AND NULLIF(BTRIM(zvg_listings.ort), '') IS NOT NULL" in lat_case
    assert "DELETE FROM zvg_images WHERE listing_id" in postgres
    com = (Path(__file__).resolve().parents[1] / "src/flows/zvg_com_daily.py").read_text()
    portal = (Path(__file__).resolve().parents[1] / "src/flows/zvg_daily.py").read_text()
    hanmark = (Path(__file__).resolve().parents[1] / "src/flows/hanmark_daily.py").read_text()
    assert "persist_zvg_gallery" in com
    assert "ON CONFLICT DO NOTHING" not in com
    assert "bind_and_persist_zvg_assets" in portal
    assert "ON CONFLICT DO NOTHING" not in portal
    assert "bind_and_persist_zvg_assets" in hanmark
    assert "ON CONFLICT DO NOTHING" not in hanmark
    assert "e2.termin_date IS NOT DISTINCT FROM l.termin_date" in postgres
    assert "JOIN zvg_listings l ON l.id = e2.listing_id" in postgres
    assert "plz = COALESCE(NULLIF(BTRIM(EXCLUDED.plz), ''), zvg_listings.plz)" in postgres
    assert "typ = COALESCE(NULLIF(BTRIM(EXCLUDED.typ), ''), zvg_listings.typ)" in postgres
    assert (
        "kategorie = COALESCE(NULLIF(BTRIM(EXCLUDED.kategorie), ''), zvg_listings.kategorie)"
        in postgres
    )
    assert (
        "denkmalschutz = COALESCE(EXCLUDED.denkmalschutz, zvg_listings.denkmalschutz)" in postgres
    )
    assert "vermietet = COALESCE(EXCLUDED.vermietet, zvg_listings.vermietet)" in postgres
    assert "ist_neu = zvg_listings.created_at >= (NOW() - INTERVAL '24 hours')" in postgres
    assert "RETURNING id, (xmax = 0) AS is_new, verkehrswert, termin_date" in postgres
    assert 'row["termin_date"]' in postgres
    upsert = postgres.split("async def upsert_zvg_listing")[1].split(
        "def storage_path_from_public_url"
    )[0]
    assert "async with conn.transaction():" in upsert
    assert upsert.index("async with conn.transaction():") < upsert.index("INSERT INTO zvg_listings")
    assert upsert.index("INSERT INTO zvg_listings") < upsert.index("await _append_auction_event")
    assert upsert.index("await _append_auction_event") < upsert.index("_enqueue_ki_analysis")
    append = postgres.split("async def _append_auction_event")[1].split(
        "async def update_auction_terms"
    )[0]
    assert "async with conn.transaction():" in append
    assert append.index("async with conn.transaction():") < append.index(
        "INSERT INTO zvg_auction_events"
    )
    assert "listing.termin_date," not in append
    portal = (Path(__file__).resolve().parents[1] / "src/sources/zvg_portal.py").read_text()
    hanmark_src = (Path(__file__).resolve().parents[1] / "src/sources/hanmark.py").read_text()
    ki = (Path(__file__).resolve().parents[1] / "src/flows/ki_analysis.py").read_text()
    assert "upload_binaries = fetch_images" in portal
    assert "upload_binaries=upload_binaries" in portal
    assert "fetch_images = False" not in portal
    assert "detail_scrape_complete=True" in hanmark_src
    assert "detail_scrape_complete=fetch_images" not in hanmark_src
    expose_fn = ki.split("async def get_listings_needing_expose_reanalysis")[1].split(
        "async def reanalyze_with_expose"
    )[0]
    assert "l.scrape_completed_at IS NOT NULL" in expose_fn
    assert "is_portal_detail_url(listing.direktlink)" in portal
    assert 'data.get("direktlink") or (' not in portal


def test_storage_path_from_public_url():
    assert (
        storage_path_from_public_url("http://minio:9000/zvg-images/abc/foto_0.jpg")
        == "abc/foto_0.jpg"
    )
    assert (
        storage_path_from_public_url("/zvg-images/bayern/haus/foto_1.jpg")
        == "bayern/haus/foto_1.jpg"
    )
    assert (
        storage_path_from_public_url("zvg-images/bayern/haus/gutachten.pdf")
        == "bayern/haus/gutachten.pdf"
    )
    assert storage_path_from_public_url("https://www.zvg.com/foto.jpg") is None
    assert storage_path_from_public_url("") is None
