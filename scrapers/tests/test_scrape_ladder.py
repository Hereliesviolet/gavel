"""fetch_page_resilient: plain HTTP fetch, no evasion of access protection.

A page that answers with a challenge or login wall is reported as blocked or
insufficient; nothing tries another route. Session cookies pasted by a user are
handed to the single request and never touch shared state.
"""

from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from src.utils.scrape_ladder import _check_domain_resolvable, fetch_page_resilient
from src.utils.url_safety import RobotsDisallowedError, UrlSafetyError

LADDER = Path(__file__).resolve().parents[1] / "src/utils/scrape_ladder.py"


def _patch_common(monkeypatch):
    monkeypatch.setattr("src.utils.scrape_ladder.check_rate_limits", lambda *a, **k: None)
    monkeypatch.setattr(
        "src.utils.scrape_ladder._check_domain_resolvable", AsyncMock(return_value=True)
    )
    monkeypatch.setattr("src.utils.scrape_ladder.assert_public_http_url", lambda url, **kw: url)
    monkeypatch.setattr("src.utils.scrape_ladder.record_scrape_attempt", lambda *a, **k: None)


def _fetch_mock(result):
    return patch("src.utils.scrape_ladder.fetch_html", AsyncMock(return_value=result))


@pytest.mark.asyncio
async def test_cookie_path_passes_cookies_to_the_single_request(monkeypatch):
    _patch_common(monkeypatch)
    cookies = [{"name": "session", "value": "abc", "domain": "example.de", "path": "/"}]
    page = {
        "content": "<html>" + ("Privates Angebot Text. " * 30) + "</html>",
        "pageStatusCode": 200,
    }
    with _fetch_mock(page) as fetch:
        result = await fetch_page_resilient(
            "https://example.de/private-listing", extra_cookies=cookies
        )

    assert result.success is True
    assert result.metadata is not None
    assert result.metadata.session_cookie_used is True
    assert result.metadata.fetch_source == "http"
    fetch.assert_awaited_once()
    assert fetch.call_args.kwargs["cookies"] == cookies


@pytest.mark.asyncio
async def test_public_path_sends_no_cookies(monkeypatch):
    _patch_common(monkeypatch)
    page = {
        "content": "<html>" + ("Wohnung zu verkaufen. " * 30) + "</html>",
        "pageStatusCode": 200,
    }
    with _fetch_mock(page) as fetch:
        result = await fetch_page_resilient("https://example.de/public-listing")

    assert result.success is True
    assert fetch.call_args.kwargs["cookies"] is None


@pytest.mark.asyncio
async def test_bot_wall_is_reported_and_sets_cooldown_without_retry(monkeypatch):
    _patch_common(monkeypatch)
    cooldown = patch("src.utils.scrape_ladder.set_domain_cooldown")
    with (
        _fetch_mock({"content": "Ich bin kein Roboter", "pageStatusCode": 403}) as fetch,
        cooldown as set_cooldown,
    ):
        result = await fetch_page_resilient("https://example.de/public-listing")

    assert result.success is False
    assert result.error_code == "BOT_BLOCKED"
    assert "HTML-Einfügung" in (result.error or "")
    set_cooldown.assert_called_once_with("example.de")
    fetch.assert_awaited_once()


@pytest.mark.asyncio
async def test_cookie_path_bot_wall_is_session_invalid_without_cooldown(monkeypatch):
    _patch_common(monkeypatch)
    no_cooldown = patch(
        "src.utils.scrape_ladder.set_domain_cooldown",
        side_effect=AssertionError("Cookie path must not set a domain cooldown"),
    )
    with _fetch_mock({"content": "Ich bin kein Roboter", "pageStatusCode": 403}), no_cooldown:
        result = await fetch_page_resilient(
            "https://example.de/private-listing",
            extra_cookies=[{"name": "session", "value": "x", "domain": "example.de", "path": "/"}],
        )

    assert result.success is False
    assert result.error_code == "COOKIE_SESSION_INVALID"


@pytest.mark.asyncio
async def test_live_path_long_login_without_expose_is_insufficient(monkeypatch):
    _patch_common(monkeypatch)
    login = "Bitte anmelden oder einloggen, um fortzufahren. " * 20
    no_cooldown = patch(
        "src.utils.scrape_ladder.set_domain_cooldown",
        side_effect=AssertionError("A login page must not set a domain cooldown"),
    )
    with _fetch_mock({"content": f"<html>{login}</html>", "pageStatusCode": 200}), no_cooldown:
        result = await fetch_page_resilient("https://example.de/public-listing")

    assert result.success is False
    assert result.error_code == "SCRAPE_INSUFFICIENT"


@pytest.mark.asyncio
async def test_cookie_path_long_login_without_expose_is_session_invalid(monkeypatch):
    _patch_common(monkeypatch)
    login = "Bitte anmelden oder einloggen, um fortzufahren. " * 20
    with _fetch_mock({"content": f"<html>{login}</html>", "pageStatusCode": 200}):
        result = await fetch_page_resilient(
            "https://example.de/private-listing",
            extra_cookies=[{"name": "session", "value": "x", "domain": "example.de", "path": "/"}],
        )

    assert result.success is False
    assert result.error_code == "COOKIE_SESSION_INVALID"


@pytest.mark.asyncio
async def test_live_path_long_expose_with_header_login_succeeds(monkeypatch):
    _patch_common(monkeypatch)
    body = "Kaufpreis 198.000 € Heller Altbau in Köln mit Balkon. " * 10
    page = {
        "content": f"<nav>Anmelden</nav><h1>Wohnung</h1><p>{body}</p>",
        "pageStatusCode": 200,
    }
    with _fetch_mock(page):
        result = await fetch_page_resilient("https://example.de/public-listing")

    assert result.success is True


@pytest.mark.asyncio
async def test_fetch_failure_is_generic(monkeypatch):
    _patch_common(monkeypatch)
    failed = {"content": "", "pageStatusCode": None, "pageError": "fetch_failed"}
    with _fetch_mock(failed):
        result = await fetch_page_resilient("https://example.de/public-listing")

    assert result.success is False
    assert result.error_code == "SCRAPE_FAILED"
    assert result.error == "Seite konnte nicht geladen werden."


@pytest.mark.asyncio
async def test_robots_disallow_is_reported_and_not_retried(monkeypatch):
    _patch_common(monkeypatch)
    blocked = patch(
        "src.utils.scrape_ladder.fetch_html",
        AsyncMock(side_effect=RobotsDisallowedError("Abruf laut robots.txt nicht erlaubt")),
    )
    with blocked as fetch:
        result = await fetch_page_resilient("https://example.de/public-listing")

    assert result.success is False
    assert result.error_code == "ROBOTS_DISALLOWED"
    assert "robots.txt" in (result.error or "")
    fetch.assert_awaited_once()


@pytest.mark.asyncio
async def test_rebinding_to_private_ip_is_blocked_before_the_request(monkeypatch):
    _patch_common(monkeypatch)
    monkeypatch.setattr(
        "src.utils.scrape_ladder.assert_public_http_url",
        lambda url, **kw: (_ for _ in ()).throw(
            UrlSafetyError("Ziel-IP ist nicht öffentlich erreichbar")
        ),
    )
    forbidden = patch(
        "src.utils.scrape_ladder.fetch_html",
        AsyncMock(side_effect=AssertionError("No request for a blocked URL")),
    )
    with forbidden:
        result = await fetch_page_resilient("https://example.de/public-listing")

    assert result.success is False
    assert result.error_code == "URL_BLOCKED"
    assert result.error == "Diese URL ist nicht erlaubt."


@pytest.mark.asyncio
async def test_unresolvable_host_is_connectivity_failed(monkeypatch):
    _patch_common(monkeypatch)
    monkeypatch.setattr(
        "src.utils.scrape_ladder.assert_public_http_url",
        lambda url, **kw: (_ for _ in ()).throw(UrlSafetyError("Seite nicht erreichbar")),
    )
    forbidden = patch(
        "src.utils.scrape_ladder.fetch_html",
        AsyncMock(side_effect=AssertionError("No request for an unresolvable host")),
    )
    with forbidden:
        result = await fetch_page_resilient("https://missing.example/public-listing")

    assert result.success is False
    assert result.error_code == "CONNECTIVITY_FAILED"
    assert "DNS-Auflösung fehlgeschlagen" in (result.error or "")


@pytest.mark.asyncio
async def test_domain_check_rejects_private_resolution(monkeypatch):
    monkeypatch.setattr(
        "src.utils.scrape_ladder.resolve_public_ips",
        lambda _host: (_ for _ in ()).throw(
            UrlSafetyError("Ziel-IP ist nicht öffentlich erreichbar")
        ),
    )
    assert await _check_domain_resolvable("https://evil.example/x") is False


def test_errors_do_not_forward_exceptions():
    ladder = LADDER.read_text()
    assert 'error="Seite konnte nicht geladen werden."' in ladder
    assert "error=str(exc)" not in ladder
    assert "error=RATE_LIMIT_USER_MESSAGE" in ladder
    assert "public_url_safety_message" in ladder
    assert "url_safety_error_code" in ladder
    safety = (LADDER.parent / "url_safety.py").read_text()
    assert 'URL_BLOCKED_USER_MESSAGE = "Diese URL ist nicht erlaubt."' in safety
    rate = (LADDER.parent / "scrape_rate_limit.py").read_text()
    assert "Stündliches Limit für {domain}" not in rate
    assert "RATE_LIMIT_USER_MESSAGE" in rate
