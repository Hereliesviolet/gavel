import ipaddress
from pathlib import Path

import httpx
import pytest

from src.utils.url_safety import (
    HostPinnedAsyncBackend,
    UrlSafetyError,
    ZVG_COM_HOSTS,
    _is_blocked_ip,
    assert_analyse_listing_url,
    assert_image_fetch_url,
    assert_public_http_url,
    assert_hanmark_url,
    assert_zvg_com_url,
    assert_zvg_portal_document_url,
    choose_connect_ip,
    fetch_public_request,
    fetch_public_url,
    assert_zvg_document_url,
    resolve_public_ips,
    is_sensitive_query_key,
    log_safe_url,
    public_url_safety_message,
    canonicalize_listing_url,
    strip_sensitive_query,
    url_safety_error_code,
)


def test_strip_sensitive_query_removes_tokens():
    assert (
        strip_sensitive_query("https://portal.example/expose/1?token=abc&keep=1")
        == "https://portal.example/expose/1?keep=1"
    )
    assert strip_sensitive_query("https://portal.example/expose/1") == (
        "https://portal.example/expose/1"
    )
    assert log_safe_url("https://portal.example/expose/1?session=leak&keep=1") == (
        "https://portal.example/expose/1?keep=1"
    )
    assert (
        strip_sensitive_query("https://portal.example/expose/1?shareToken=SECRET&id=9")
        == "https://portal.example/expose/1?id=9"
    )
    assert is_sensitive_query_key("authKey") is True
    assert is_sensitive_query_key("ort") is False
    assert is_sensitive_query_key("author_id") is False
    market_src = Path(__file__).resolve().parents[1] / "src/storage/market.py"
    assert "canonicalize_listing_url(angebot.url)" in market_src.read_text()
    assert canonicalize_listing_url("https://Portal.Example/expose/1?token=abc&keep=1") == (
        "https://portal.example/expose/1?keep=1"
    )


def test_allows_immowelt():
    url = assert_analyse_listing_url("https://www.immowelt.de/expose/123")
    assert "immowelt.de" in url


def test_allows_generic_public_domain():
    """Phase 2: beliebige öffentliche https-Property-URL, keine feste Allowlist mehr."""
    url = assert_analyse_listing_url("https://example.com/wohnung-123")
    assert "example.com" in url


def test_rejects_localhost():
    with pytest.raises(UrlSafetyError):
        assert_analyse_listing_url("http://127.0.0.1:5432/")


def test_rejects_private_ip_literal():
    with pytest.raises(UrlSafetyError):
        assert_analyse_listing_url("https://192.168.1.1/x")


def test_rejects_link_local_metadata_ip():
    with pytest.raises(UrlSafetyError):
        assert_analyse_listing_url("https://169.254.169.254/latest/meta-data/")


def test_rejects_http_scheme():
    """Seit Phase 2 wird für Custom-URL-Analysen ausschließlich https unterstützt."""
    with pytest.raises(UrlSafetyError):
        assert_analyse_listing_url("http://www.example-makler.de/wohnung-123")


def test_rejects_dot_internal_and_dot_local():
    with pytest.raises(UrlSafetyError):
        assert_analyse_listing_url("https://service.internal/x")
    with pytest.raises(UrlSafetyError):
        assert_analyse_listing_url("https://printer.local/x")
    with pytest.raises(UrlSafetyError):
        assert_analyse_listing_url("https://web.default.svc.cluster.local/x")


def test_rejects_credentials_in_url():
    with pytest.raises(UrlSafetyError):
        assert_analyse_listing_url("https://user:pass@example.de/x")


def test_rejects_unresolvable_domain():
    with pytest.raises(UrlSafetyError, match="Seite nicht erreichbar") as exc:
        assert_analyse_listing_url("https://this-domain-does-not-exist-gavel.invalid/x")
    assert "this-domain-does-not-exist-gavel.invalid" not in str(exc.value)
    assert url_safety_error_code(exc.value) == "CONNECTIVITY_FAILED"
    assert "nicht erreichbar" in public_url_safety_message(exc.value)
    assert "this-domain-does-not-exist-gavel.invalid" not in public_url_safety_message(exc.value)


def test_public_url_safety_message_hides_block_reason():
    blocked = UrlSafetyError("Ziel-IP ist nicht öffentlich erreichbar")
    assert url_safety_error_code(blocked) == "URL_BLOCKED"
    assert public_url_safety_message(blocked) == "Diese URL ist nicht erlaubt."
    assert public_url_safety_message(UrlSafetyError("URL fehlt")) == "URL fehlt"
    assert public_url_safety_message(UrlSafetyError("Seite nicht erreichbar")).startswith(
        "Diese Domain ist nicht erreichbar"
    )
    api = (Path(__file__).resolve().parents[1] / "src/api/app.py").read_text()
    assert "public_url_safety_message(e)" in api
    assert "except UrlSafetyError as e:\n            msg = str(e)" not in api


def test_ipv4_mapped_ipv6_loopback_is_blocked():
    assert _is_blocked_ip(ipaddress.ip_address("::ffff:127.0.0.1"))


def test_ipv4_mapped_ipv6_private_is_blocked():
    assert _is_blocked_ip(ipaddress.ip_address("::ffff:10.0.0.5"))


def test_ipv6_unique_local_is_blocked():
    assert _is_blocked_ip(ipaddress.ip_address("fd00::1"))


def test_assert_public_http_url_allows_http_when_not_required():
    url = assert_public_http_url("http://example.de/x", require_https=False)
    assert url == "http://example.de/x"


def test_rejects_decimal_ipv4_loopback():
    with pytest.raises(UrlSafetyError):
        assert_analyse_listing_url("https://2130706433/x")


def test_rejects_short_ipv4_loopback():
    with pytest.raises(UrlSafetyError):
        assert_analyse_listing_url("https://127.1/x")


def test_rejects_octal_ipv4_loopback():
    with pytest.raises(UrlSafetyError):
        assert_analyse_listing_url("https://0177.0.0.1/x")


def test_rejects_localhost_suffix():
    with pytest.raises(UrlSafetyError):
        assert_analyse_listing_url("https://app.localhost/x")


def test_reference_url_syntax_blocks_private_without_dns():
    with pytest.raises(UrlSafetyError):
        assert_public_http_url(
            "https://192.168.0.5/x",
            require_https=True,
            resolve_dns=False,
        )


def test_reference_url_syntax_allows_unknown_public_host():
    url = assert_public_http_url(
        "https://www.privates-portal.de/angebot/1",
        require_https=True,
        resolve_dns=False,
    )
    assert "privates-portal.de" in url


def test_resolve_public_ips_rejects_if_any_record_is_private(monkeypatch):
    def fake_getaddrinfo(host, _port, *args, **kwargs):
        return [
            (2, 1, 6, "", ("93.184.216.34", 0)),
            (2, 1, 6, "", ("127.0.0.1", 0)),
        ]

    monkeypatch.setattr("src.utils.url_safety.socket.getaddrinfo", fake_getaddrinfo)
    with pytest.raises(UrlSafetyError, match="nicht öffentlich"):
        resolve_public_ips("evil.example")


def test_resolve_public_ips_returns_unique_public_records(monkeypatch):
    def fake_getaddrinfo(host, _port, *args, **kwargs):
        return [
            (2, 1, 6, "", ("93.184.216.34", 0)),
            (2, 1, 6, "", ("93.184.216.34", 0)),
            (10, 1, 6, "", ("2606:2800:220:1:248:1893:25c8:1946", 0)),
        ]

    monkeypatch.setattr("src.utils.url_safety.socket.getaddrinfo", fake_getaddrinfo)
    assert resolve_public_ips("example.com") == [
        "93.184.216.34",
        "2606:2800:220:1:248:1893:25c8:1946",
    ]


def test_choose_connect_ip_prefers_ipv4():
    assert (
        choose_connect_ip(["2606:2800:220:1:248:1893:25c8:1946", "93.184.216.34"])
        == "93.184.216.34"
    )


@pytest.mark.asyncio
async def test_pinned_backend_connects_to_resolved_public_ip():
    class _Inner:
        def __init__(self):
            self.hosts: list[str] = []

        async def connect_tcp(
            self, host, port, timeout=None, local_address=None, socket_options=None
        ):
            self.hosts.append(host)
            return object()

        async def sleep(self, seconds):
            return None

    inner = _Inner()
    backend = HostPinnedAsyncBackend(inner, {"example.com": "93.184.216.34"})
    await backend.connect_tcp("example.com", 443)
    assert inner.hosts == ["93.184.216.34"]


@pytest.mark.asyncio
async def test_pinned_backend_rejects_private_pin():
    class _Inner:
        async def connect_tcp(
            self, host, port, timeout=None, local_address=None, socket_options=None
        ):
            raise AssertionError("private IP darf nicht verbunden werden")

    backend = HostPinnedAsyncBackend(_Inner(), {"example.com": "127.0.0.1"})
    with pytest.raises(UrlSafetyError, match="nicht öffentlich"):
        await backend.connect_tcp("example.com", 443)


def test_assert_image_fetch_url_rejects_private():
    assert assert_image_fetch_url("http://127.0.0.1/foto.jpg") is None
    assert assert_image_fetch_url("https://192.168.1.4/x.jpg") is None
    assert assert_image_fetch_url("javascript:alert(1)") is None


def test_assert_zvg_com_url_binds_host():
    url = assert_zvg_com_url("https://www.zvg.com/bilder/x.jpg", resolve_dns=False)
    assert "zvg.com" in url
    with pytest.raises(UrlSafetyError):
        assert_zvg_com_url("https://evil.example/x.jpg", resolve_dns=False)


def test_assert_hanmark_url_binds_host():
    url = assert_hanmark_url("https://www.hanmark.de/wertgutachten-1.html", resolve_dns=False)
    assert "hanmark.de" in url
    with pytest.raises(UrlSafetyError):
        assert_hanmark_url("https://evil.example/x", resolve_dns=False)


def test_assert_zvg_portal_document_url_binds_host():
    url = assert_zvg_portal_document_url(
        "https://www.zvg-portal.de/index.php?button=showAnhang&file_id=1",
        resolve_dns=False,
    )
    assert "zvg-portal.de" in url
    with pytest.raises(UrlSafetyError):
        assert_zvg_portal_document_url("https://evil.example/malware.pdf", resolve_dns=False)
    with pytest.raises(UrlSafetyError):
        assert_zvg_portal_document_url(
            "http://www.zvg-portal.de/index.php?button=showAnhang",
            resolve_dns=False,
        )


def test_assert_zvg_document_url_binds_portal_hosts():
    url = assert_zvg_document_url("https://www.zvg.com/gutachten.pdf", resolve_dns=False)
    assert "zvg.com" in url
    with pytest.raises(UrlSafetyError):
        assert_zvg_document_url("https://evil.example/gutachten.pdf", resolve_dns=False)
    with pytest.raises(UrlSafetyError):
        assert_zvg_document_url("http://www.zvg-portal.de/gutachten.pdf", resolve_dns=False)


class _FakeResponse:
    def __init__(self, status_code, location=None, url="https://zvg.com/a"):
        self.status_code = status_code
        self.headers = {"location": location} if location else {}
        self.request = type("Req", (), {"url": url})()
        self.text = "ok"
        self.content = b"ok"


def _install_scripted_client(monkeypatch, script, calls):
    remaining = list(script)

    def fake_pinned(url, **kwargs):
        class _Client:
            def __init__(self):
                self.cookies = kwargs.get("cookies") or httpx.Cookies()

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return None

            async def request(self, method, req_url, **req_kwargs):
                calls.append((method, req_url, req_kwargs))
                if not remaining:
                    raise AssertionError(f"unerwarteter Request {method} {req_url}")
                return remaining.pop(0)

        return _Client()

    monkeypatch.setattr(
        "src.utils.url_safety.resolve_public_ips",
        lambda host: ["93.184.216.34"],
    )
    monkeypatch.setattr("src.utils.url_safety._pinned_async_client", fake_pinned)


@pytest.mark.asyncio
async def test_fetch_public_request_rejects_redirect_off_allowlist(monkeypatch):
    calls = []
    _install_scripted_client(
        monkeypatch,
        [_FakeResponse(302, "https://evil.example/steal", "https://zvg.com/grid")],
        calls,
    )
    with pytest.raises(UrlSafetyError, match="nicht erlaubt"):
        await fetch_public_request(
            "GET",
            "https://zvg.com/v2024/termine.prg",
            allowed_hosts=ZVG_COM_HOSTS,
        )
    assert calls == [("GET", "https://zvg.com/v2024/termine.prg", {})]


@pytest.mark.asyncio
async def test_fetch_public_request_follows_allowed_host_redirect(monkeypatch):
    calls = []
    _install_scripted_client(
        monkeypatch,
        [
            _FakeResponse(302, "https://www.zvg.com/grid", "https://zvg.com/start"),
            _FakeResponse(200, url="https://www.zvg.com/grid"),
        ],
        calls,
    )
    resp = await fetch_public_request(
        "GET",
        "https://zvg.com/start",
        allowed_hosts=ZVG_COM_HOSTS,
    )
    assert resp.status_code == 200
    assert [url for _, url, _ in calls] == [
        "https://zvg.com/start",
        "https://www.zvg.com/grid",
    ]


@pytest.mark.asyncio
async def test_fetch_public_request_post_303_becomes_get(monkeypatch):
    calls = []
    _install_scripted_client(
        monkeypatch,
        [
            _FakeResponse(303, "/index.php?seite=1", "https://www.zvg-portal.de/index.php"),
            _FakeResponse(200, url="https://www.zvg-portal.de/index.php?seite=1"),
        ],
        calls,
    )
    resp = await fetch_public_request(
        "POST",
        "https://www.zvg-portal.de/index.php",
        data={"land_abk": "by"},
        allowed_hosts=frozenset({"zvg-portal.de", "www.zvg-portal.de"}),
    )
    assert resp.status_code == 200
    assert calls[0][0] == "POST"
    assert calls[0][2]["data"] == {"land_abk": "by"}
    assert calls[1] == (
        "GET",
        "https://www.zvg-portal.de/index.php?seite=1",
        {},
    )


@pytest.mark.asyncio
async def test_fetch_public_request_rejects_too_many_redirects(monkeypatch):
    calls = []
    hops = [
        _FakeResponse(302, f"https://zvg.com/h{i}", f"https://zvg.com/h{i - 1}")
        for i in range(1, 8)
    ]
    _install_scripted_client(monkeypatch, hops, calls)
    with pytest.raises(UrlSafetyError, match="Zu viele Redirects"):
        await fetch_public_request(
            "GET",
            "https://zvg.com/h0",
            allowed_hosts=ZVG_COM_HOSTS,
        )


@pytest.mark.asyncio
async def test_fetch_public_request_rejects_unsafe_method():
    with pytest.raises(UrlSafetyError, match="Methode"):
        await fetch_public_request("PUT", "https://zvg.com/x", allowed_hosts=ZVG_COM_HOSTS)


@pytest.mark.asyncio
async def test_fetch_public_url_is_get_wrapper(monkeypatch):
    calls = []
    _install_scripted_client(
        monkeypatch,
        [_FakeResponse(200, url="https://example.com/x")],
        calls,
    )
    resp = await fetch_public_url("https://example.com/x", require_https=True)
    assert resp.status_code == 200
    assert calls == [("GET", "https://example.com/x", {})]
