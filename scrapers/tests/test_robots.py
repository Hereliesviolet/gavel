import httpx
import pytest

from src.utils import robots


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    robots.clear_cache()
    monkeypatch.setenv("RESPECT_ROBOTS_TXT", "true")
    yield
    robots.clear_cache()


def _serve(monkeypatch, status: int, body: str = ""):
    calls: list[str] = []

    async def fake(method, url, **kwargs):
        calls.append(url)
        assert kwargs["respect_robots"] is False
        return httpx.Response(status, text=body, request=httpx.Request("GET", url))

    monkeypatch.setattr("src.utils.url_safety.fetch_public_request", fake)
    return calls


@pytest.mark.asyncio
async def test_disallowed_path_is_refused_and_others_allowed(monkeypatch):
    calls = _serve(monkeypatch, 200, "User-agent: *\nDisallow: /privat/\n")
    assert await robots.is_allowed("https://example.com/privat/1") is False
    assert await robots.is_allowed("https://example.com/oeffentlich/1") is True
    assert calls == ["https://example.com/robots.txt"]  # cached per origin


@pytest.mark.asyncio
async def test_own_token_rules_take_precedence(monkeypatch):
    _serve(monkeypatch, 200, "User-agent: Gavel\nDisallow: /\n\nUser-agent: *\nAllow: /\n")
    assert await robots.is_allowed("https://example.com/a") is False


@pytest.mark.asyncio
async def test_missing_robots_allows_everything(monkeypatch):
    _serve(monkeypatch, 404)
    assert await robots.is_allowed("https://example.com/a") is True


@pytest.mark.asyncio
async def test_unreachable_robots_suspends_access(monkeypatch):
    _serve(monkeypatch, 503)
    assert await robots.is_allowed("https://example.com/a") is False


@pytest.mark.asyncio
async def test_network_error_suspends_access(monkeypatch):
    async def boom(method, url, **kwargs):
        raise httpx.ConnectError("no route")

    monkeypatch.setattr("src.utils.url_safety.fetch_public_request", boom)
    assert await robots.is_allowed("https://example.com/a") is False


def test_check_can_be_switched_off(monkeypatch):
    monkeypatch.setenv("RESPECT_ROBOTS_TXT", "false")
    assert robots.enabled() is False
