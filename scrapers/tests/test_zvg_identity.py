from pathlib import Path

import pytest
from bs4 import BeautifulSoup

from src.models.zvg import ZvgListing
from src.sources import zvg_portal as portal_mod
from src.sources.zvg_portal import (
    SEARCH_URL,
    _parse_objekte_from_soup,
    scrape_bundesland,
)
from src.storage.minio import listing_owned_object_key, rebind_stored_url_to_listing
from src.storage.postgres import _adopt_legacy_row
from src.utils.zvg_identity import listing_identity_key, orts_compatible, zvg_listing_slug


def test_orts_compatible_allows_empty_and_rejects_other_city():
    assert orts_compatible(None, "Landshut") is True
    assert orts_compatible("München", None) is True
    assert orts_compatible("München", "Muenchen") is True
    assert orts_compatible("München", "Landshut") is False


def _listing(*, court: str, ort: str) -> ZvgListing:
    return ZvgListing(
        aktenzeichen="5 K 12/24",
        bundesland="bayern",
        bundesland_name="Bayern",
        slug="5-k-12-24-bayern",
        source="justizportal",
        amtsgericht=court,
        ort=ort,
    )


class _FakeAdoptConn:
    def __init__(self, row, collision):
        self.row = row
        self.collision = collision
        self.updates: list[tuple] = []

    async def fetchrow(self, _sql, *_args):
        return self.row

    async def fetchval(self, _sql, *_args):
        return self.collision

    async def execute(self, sql, *args):
        self.updates.append((sql, args))


@pytest.mark.asyncio
async def test_adopt_legacy_skips_when_ort_belongs_to_other_court():
    conn = _FakeAdoptConn({"id": "legacy", "ort": "München"}, collision=None)
    await _adopt_legacy_row(conn, _listing(court="Landshut", ort="Landshut"), "Landshut")
    assert conn.updates == []


@pytest.mark.asyncio
async def test_adopt_legacy_skips_when_court_identity_already_exists():
    conn = _FakeAdoptConn({"id": "legacy", "ort": "München"}, collision=1)
    await _adopt_legacy_row(conn, _listing(court="München", ort="München"), "München")
    assert conn.updates == []


@pytest.mark.asyncio
async def test_adopt_legacy_updates_compatible_null_court_row():
    conn = _FakeAdoptConn({"id": "legacy", "ort": "München"}, collision=None)
    await _adopt_legacy_row(conn, _listing(court="AG München", ort="München"), "AG München")
    assert len(conn.updates) == 1
    assert conn.updates[0][1] == ("München", "legacy")


def test_identity_keeps_same_az_at_two_courts_apart():
    a = listing_identity_key("bayern", "AG München", "5 K 12/24")
    b = listing_identity_key("bayern", "Amtsgericht Landshut", "5 K 12/24")
    assert a[0] == "bayern"
    assert a[1] == "München"
    assert a[2] == "5 K 12/24"
    assert a != b
    assert listing_identity_key("bayern", "München", "5 K 12/24") == a


def test_slug_includes_normalized_court():
    first = zvg_listing_slug("5 K 12/24", "bayern", amtsgericht="AG München", ort="München")
    second = zvg_listing_slug("5 K 12/24", "bayern", amtsgericht="Landshut", ort="Landshut")
    assert "muenchen" in first
    assert "landshut" in second
    assert first != second
    assert zvg_listing_slug(
        "5 K 12/24", "bayern", amtsgericht="AG München", ort="München", marker="hanmark"
    ).startswith("5-k-12-24-hanmark-")


def test_portal_grid_keeps_same_az_at_two_courts():
    html = """
    <table>
      <tr><td>Aktenzeichen</td><td>5 K 12/24</td></tr>
      <tr><td>Amtsgericht</td><td>München</td></tr>
      <tr><td>Objekt/Lage</td><td>Wohnung, 80331 München</td></tr>
      <tr><td>Aktenzeichen</td><td>5 K 12/24</td></tr>
      <tr><td>Amtsgericht</td><td>Landshut</td></tr>
      <tr><td>Objekt/Lage</td><td>Haus, 84028 Landshut</td></tr>
    </table>
    """
    listings = _parse_objekte_from_soup(
        BeautifulSoup(html, "html.parser"), "bayern", "Bayern", "by"
    )
    assert len(listings) == 2
    assert {row.amtsgericht for row in listings} == {"München", "Landshut"}
    assert listings[0].slug != listings[1].slug
    assert "muenchen" in listings[0].slug or "muenchen" in listings[1].slug
    assert "landshut" in listings[0].slug or "landshut" in listings[1].slug


def test_sources_dedupe_on_identity_not_slug():
    portal = (Path(__file__).resolve().parents[1] / "src/sources/zvg_portal.py").read_text()
    hanmark = (Path(__file__).resolve().parents[1] / "src/sources/hanmark.py").read_text()
    com = (Path(__file__).resolve().parents[1] / "src/sources/zvg_com.py").read_text()
    assets = (Path(__file__).resolve().parents[1] / "src/storage/zvg_assets.py").read_text()
    minio = (Path(__file__).resolve().parents[1] / "src/storage/minio.py").read_text()
    assert "seen_slugs" not in portal
    assert "seen_az" not in portal
    assert "listing_identity_key(" in portal
    assert "zvg_listing_slug(" in portal
    assert "aktenzeichen=listing.aktenzeichen" in portal
    assert "seen_slugs" not in hanmark
    assert "listing_identity_key(" in hanmark
    assert 'marker="hanmark"' in hanmark
    assert "seen_slugs" not in com
    assert "listing_identity_key(" in com
    assert "bind_and_persist_zvg_assets" in assets
    assert "rebind_stored_url_to_listing" in assets
    assert "listing_owned_object_key" in minio


def test_portal_search_uses_all_results_post():
    portal = (Path(__file__).resolve().parents[1] / "src/sources/zvg_portal.py").read_text()
    assert 'f"{SEARCH_URL}&all=1"' in portal
    assert "button=Suchen&land_abk=" not in portal
    assert "seite={page}" not in portal
    assert "_continue_portal_pagination" not in portal
    assert "not new_listings" not in portal


def _portal_result_page(*rows: tuple[str, str, str]) -> str:
    parts = ["<html><body><h2>Insgesamt %d</h2><table>" % len(rows)]
    for az, court, lage in rows:
        parts.append(
            f"<tr><td>Aktenzeichen</td><td>{az}</td></tr>"
            f"<tr><td>Amtsgericht</td><td>{court}</td></tr>"
            f"<tr><td>Objekt/Lage</td><td>{lage}</td></tr>"
        )
    parts.append("</table></body></html>")
    return "".join(parts)


class _FakePortalResponse:
    def __init__(self, text: str):
        self.text = text

    def raise_for_status(self) -> None:
        return None


@pytest.mark.asyncio
async def test_scrape_keeps_all_identities_from_all_results(monkeypatch):
    html = _portal_result_page(
        ("5 K 12/24", "München", "Wohnung, 80331 München"),
        ("5 K 12/24", "München", "Wohnung, 80331 München"),
        ("5 K 99/24", "Landshut", "Haus, 84028 Landshut"),
    )
    fetched: list[str] = []

    async def fake_fetch(method, url, **_kwargs):
        fetched.append(f"{method} {url}")
        return _FakePortalResponse(html)

    monkeypatch.setattr(portal_mod, "DELAY", 0)
    monkeypatch.setattr(portal_mod, "fetch_public_request", fake_fetch)

    listings = await scrape_bundesland("bayern", fetch_images=False)
    assert fetched == [f"POST {SEARCH_URL}&all=1"]
    assert {row.aktenzeichen for row in listings} == {"5 K 12/24", "5 K 99/24"}


def test_rebind_skips_external_and_already_owned():
    listing_id = "11111111-1111-1111-1111-111111111111"
    assert (
        rebind_stored_url_to_listing(
            "https://www.hanmark.de/wertgutachten.pdf", listing_id, "gutachten.pdf"
        )
        is None
    )
    owned = f"http://minio:9000/zvg-images/{listing_id}/gutachten.pdf"
    assert rebind_stored_url_to_listing(owned, listing_id, "gutachten.pdf") == owned
    assert listing_owned_object_key(listing_id, "gutachten.pdf") == f"{listing_id}/gutachten.pdf"
    assert rebind_stored_url_to_listing(owned, listing_id, "../etc/passwd") is None
