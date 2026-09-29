import httpx
import pytest

from src.utils.page_fetch import fetch_html, fetch_page
from src.utils.url_safety import RobotsDisallowedError, UrlSafetyError

_ALLOWED = frozenset({"example.com", "www.example.com"})


def _response(url: str, status: int = 200, text: str = "<html>ok</html>") -> httpx.Response:
    return httpx.Response(status, text=text, request=httpx.Request("GET", url))


def _patch_request(monkeypatch, handler):
    calls: list[dict] = []

    async def fake(method, url, **kwargs):
        calls.append({"method": method, "url": url, **kwargs})
        return handler(url, kwargs)

    monkeypatch.setattr("src.utils.page_fetch.fetch_public_request", fake)
    return calls


@pytest.mark.asyncio
async def test_fetch_page_returns_text_html_and_links(monkeypatch):
    html = '<html><body><p>Hallo</p><a href="/x">x</a></body></html>'
    calls = _patch_request(monkeypatch, lambda url, kw: _response(url, text=html))

    result = await fetch_page("https://example.com/a", allowed_hosts=_ALLOWED)

    assert result.success is True
    assert result.raw_html == html
    assert "Hallo" in result.markdown
    assert result.links == ["https://example.com/x"]
    assert calls[0]["allowed_hosts"] == _ALLOWED
    assert calls[0]["headers"]["User-Agent"].startswith("Gavel/")


@pytest.mark.asyncio
async def test_fetch_page_reports_robots_disallow(monkeypatch):
    def handler(url, kw):
        raise RobotsDisallowedError("Abruf laut robots.txt nicht erlaubt")

    _patch_request(monkeypatch, handler)
    result = await fetch_page("https://example.com/a")
    assert result.success is False
    assert "robots.txt" in (result.error or "")


@pytest.mark.asyncio
async def test_fetch_page_rejects_unsafe_targets(monkeypatch):
    def handler(url, kw):
        raise UrlSafetyError("Ziel-IP ist nicht öffentlich erreichbar")

    _patch_request(monkeypatch, handler)
    result = await fetch_page("https://example.com/a")
    assert result.success is False
    assert result.error == "URL nicht erlaubt"


@pytest.mark.asyncio
async def test_fetch_html_scopes_cookies_to_the_host(monkeypatch):
    calls = _patch_request(monkeypatch, lambda url, kw: _response(url))

    data = await fetch_html(
        "https://example.com/private",
        cookies=[{"name": "session", "value": "abc"}],
    )

    assert data["pageStatusCode"] == 200
    assert data["content"] == "<html>ok</html>"
    jar = calls[0]["cookies"]
    assert jar.get("session", domain="example.com") == "abc"
    assert calls[0]["headers"]["User-Agent"] == data["userAgent"]


@pytest.mark.asyncio
async def test_fetch_html_without_cookies_passes_none(monkeypatch):
    calls = _patch_request(monkeypatch, lambda url, kw: _response(url))
    await fetch_html("https://example.com/p")
    assert calls[0]["cookies"] is None


@pytest.mark.asyncio
async def test_fetch_html_generic_failure(monkeypatch):
    def handler(url, kw):
        raise httpx.ConnectError("boom")

    _patch_request(monkeypatch, handler)
    data = await fetch_html("https://example.com/p")
    assert data == {"content": "", "pageStatusCode": None, "pageError": "fetch_failed"}
