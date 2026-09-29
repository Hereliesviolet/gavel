"""SSRF-Schutz für Custom-URL-Fetches und Bild-Downloads.

Erlaubt ist jede öffentlich erreichbare https-URL, solange sie nicht auf ein
privates/reserviertes Netz oder einen internen Hostnamen zeigt. Zusätzlich
prüft `fetch_public_request` vor jedem Abruf die robots.txt des Zielhosts
(siehe robots.py)."""

from __future__ import annotations

import ipaddress
import re
import socket
from typing import Optional
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse

import httpcore
import httpx
from loguru import logger

from src.utils import robots

MAX_URL_LENGTH = 2048
MAX_REDIRECT_HOPS = 5
REDIRECT_CHECK_TIMEOUT_SEC = 6.0

_BLOCKED_HOSTNAMES = {
    "localhost",
    "localhost.localdomain",
    "ip6-localhost",
    "ip6-loopback",
    "metadata",
    "metadata.google.internal",
    "instance-data",
}
_BLOCKED_HOST_SUFFIXES = (
    ".local",
    ".internal",
    ".localhost",
    ".localdomain",
    ".svc",
    ".cluster.local",
    ".nip.io",
    ".sslip.io",
    ".xip.io",
)


class UrlSafetyError(ValueError):
    pass


class RobotsDisallowedError(UrlSafetyError):
    """Der Betreiber schließt den Abruf per robots.txt aus (oder sie ist nicht erreichbar)."""


URL_BLOCKED_USER_MESSAGE = "Diese URL ist nicht erlaubt."
URL_UNREACHABLE_USER_MESSAGE = (
    "Diese Domain ist nicht erreichbar (DNS-Auflösung fehlgeschlagen). "
    "Bitte die URL auf Tippfehler prüfen."
)
_URL_UNREACHABLE_MARKERS = ("nicht auflösbar", "seite nicht erreichbar")
_URL_VALIDATION_MESSAGES = frozenset(
    {
        "URL fehlt",
        "URL zu lang",
        "Ungültige URL",
        "Nur http(s)-URLs sind erlaubt",
        "Nur https-URLs werden unterstützt",
        "URL mit Zugangsdaten ist nicht erlaubt",
    }
)


ROBOTS_DISALLOWED_USER_MESSAGE = (
    "Der Betreiber dieser Seite schließt den automatischen Abruf aus (robots.txt). "
    "Bitte die Seite über HTML-Einfügung oder PDF-Upload analysieren."
)


def url_safety_error_code(exc: BaseException) -> str:
    if isinstance(exc, RobotsDisallowedError):
        return "ROBOTS_DISALLOWED"
    text = str(exc).strip().lower()
    if any(marker in text for marker in _URL_UNREACHABLE_MARKERS):
        return "CONNECTIVITY_FAILED"
    return "URL_BLOCKED"


def public_url_safety_message(exc: BaseException) -> str:
    if isinstance(exc, RobotsDisallowedError):
        return ROBOTS_DISALLOWED_USER_MESSAGE
    text = str(exc).strip()
    if url_safety_error_code(exc) == "CONNECTIVITY_FAILED":
        return URL_UNREACHABLE_USER_MESSAGE
    if text in _URL_VALIDATION_MESSAGES:
        return text
    return URL_BLOCKED_USER_MESSAGE


_SENSITIVE_QUERY_KEYS = frozenset(
    {
        "token",
        "access_token",
        "refresh_token",
        "id_token",
        "session",
        "sessionid",
        "code",
        "auth",
        "key",
        "api_key",
        "apikey",
        "signature",
        "sid",
        "secret",
        "password",
        "passwd",
        "jwt",
        "bearer",
    }
)
_SENSITIVE_QUERY_SEGMENTS = frozenset(
    {
        "token",
        "secret",
        "password",
        "passwd",
        "jwt",
        "session",
        "sessionid",
        "auth",
        "key",
        "apikey",
        "signature",
        "sid",
        "bearer",
        "hmac",
        "otp",
    }
)
_CAMEL_SPLIT = re.compile(r"([a-z])([A-Z])")


def is_sensitive_query_key(key: str) -> bool:
    lower = key.strip().lower()
    if not lower:
        return False
    if lower in _SENSITIVE_QUERY_KEYS:
        return True
    if any(part in lower for part in ("token", "secret", "password", "passwd", "jwt", "session")):
        return True
    segments = _CAMEL_SPLIT.sub(r"\1_\2", key).lower().replace("-", "_").split("_")
    return any(part in _SENSITIVE_QUERY_SEGMENTS for part in segments if part)


def strip_sensitive_query(url: str) -> str:
    parsed = urlparse(url)
    if not parsed.query:
        return url
    pairs = parse_qsl(parsed.query, keep_blank_values=True)
    kept = [(key, value) for key, value in pairs if not is_sensitive_query_key(key)]
    if len(kept) == len(pairs):
        return url
    return urlunparse(parsed._replace(query=urlencode(kept)))


def normalize_listing_url(url: str) -> str:
    """Tracking-Query und Fragment von Exposé-URLs entfernen (Referrer-/Suchparameter
    gehören nicht zur Identität des Angebots)."""
    parsed = urlparse(url.strip())
    path = parsed.path or ""
    query = parsed.query
    path_l = path.lower()
    if "/expose/" in path_l or "/s-anzeige/" in path_l:
        query = ""
    return urlunparse((parsed.scheme, parsed.netloc, path, "", query, ""))


def canonicalize_listing_url(url: str) -> str:
    cleaned = strip_sensitive_query(url)
    parsed = urlparse(cleaned)
    if not parsed.netloc:
        return cleaned
    path = parsed.path or "/"
    return urlunparse((parsed.scheme, parsed.netloc.lower(), path, "", parsed.query, ""))


def log_safe_url(url: str) -> str:
    try:
        return strip_sensitive_query(url)
    except Exception:
        return "[url]"


def _is_blocked_ip(ip: ipaddress._BaseAddress) -> bool:
    # IPv4-mapped IPv6 (z.B. "::ffff:127.0.0.1") separat prüfen: einige
    # Python-Versionen werten is_private/is_loopback auf IPv6Address nicht
    # über die eingebettete IPv4-Adresse aus - ein bekannter SSRF-Bypass für
    # reine IPv6-Stacks.
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return bool(
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def _is_blocked_hostname(host: str) -> bool:
    if host in _BLOCKED_HOSTNAMES:
        return True
    return any(host.endswith(suffix) for suffix in _BLOCKED_HOST_SUFFIXES)


def _literal_ip_from_host(host: str) -> ipaddress._BaseAddress | None:
    """Erkennt IP-Literale inkl. SSRF-Bypasses (Dezimal, Oktal, Kurzform)."""
    try:
        return ipaddress.ip_address(host)
    except ValueError:
        pass

    if host.isdigit():
        value = int(host)
        if 0 <= value <= 0xFFFFFFFF:
            return ipaddress.IPv4Address(value)
        return None

    if "." not in host:
        return None

    parts = host.split(".")
    if not (1 <= len(parts) <= 4) or not all(parts):
        return None

    nums: list[int] = []
    for part in parts:
        try:
            if part.lower().startswith("0x"):
                nums.append(int(part, 16))
            elif len(part) > 1 and part.startswith("0") and part.isdigit():
                nums.append(int(part, 8))
            elif part.isdigit():
                nums.append(int(part, 10))
            else:
                return None
        except ValueError:
            return None

    try:
        if len(nums) == 1:
            return ipaddress.IPv4Address(nums[0])
        if len(nums) == 2:
            if nums[0] > 255 or nums[1] > 0xFFFFFF:
                return None
            return ipaddress.IPv4Address((nums[0] << 24) | nums[1])
        if len(nums) == 3:
            if nums[0] > 255 or nums[1] > 255 or nums[2] > 0xFFFF:
                return None
            return ipaddress.IPv4Address((nums[0] << 24) | (nums[1] << 16) | nums[2])
        if any(n > 255 for n in nums):
            return None
        return ipaddress.IPv4Address(bytes(nums))
    except (ValueError, OverflowError):
        return None


def _host_looks_like_ip_literal(host: str) -> bool:
    if ":" in host:
        return True
    if host.isdigit():
        return True
    return (
        bool(host)
        and all(part.lower().startswith("0x") or part.isdigit() for part in host.split("."))
        and "." in host
    )


def _assert_host_and_scheme(host: str, scheme: str, *, require_https: bool) -> None:
    if not host:
        raise UrlSafetyError("Ungültige URL")
    if _is_blocked_hostname(host):
        raise UrlSafetyError("Ziel-Host ist nicht erlaubt")
    if require_https and scheme != "https":
        raise UrlSafetyError("Nur https-URLs werden unterstützt")

    literal = _literal_ip_from_host(host)
    if literal is not None and _is_blocked_ip(literal):
        raise UrlSafetyError("Ziel-IP ist nicht öffentlich erreichbar")
    if literal is None and _host_looks_like_ip_literal(host):
        raise UrlSafetyError("Ziel-IP ist nicht öffentlich erreichbar")


def resolve_public_ips(host: str) -> list[str]:
    """Löst den Host auf und lehnt ab, sobald auch nur eine Adresse privat ist."""
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as e:
        raise UrlSafetyError("Seite nicht erreichbar") from e

    ips: list[str] = []
    seen: set[str] = set()
    for info in infos:
        raw_ip = info[4][0]
        try:
            ip = ipaddress.ip_address(raw_ip.split("%")[0])
        except ValueError:
            continue
        if _is_blocked_ip(ip):
            raise UrlSafetyError("Ziel-IP ist nicht öffentlich erreichbar")
        text = str(ip)
        if text not in seen:
            seen.add(text)
            ips.append(text)
    if not ips:
        raise UrlSafetyError("Seite nicht erreichbar")
    return ips


def choose_connect_ip(ips: list[str]) -> str:
    for ip in ips:
        if ":" not in ip:
            return ip
    return ips[0]


def _assert_resolves_public(host: str) -> None:
    resolve_public_ips(host)


class HostPinnedAsyncBackend(httpcore.AsyncNetworkBackend):
    """TCP geht auf die vorab geprüfte IP, SNI/Host bleiben am Original-Host."""

    def __init__(self, inner: httpcore.AsyncNetworkBackend, host_ip: dict[str, str]):
        self._inner = inner
        self._host_ip = {key.lower().rstrip("."): value for key, value in host_ip.items()}

    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,
        local_address: str | None = None,
        socket_options: list | None = None,
    ) -> httpcore.AsyncNetworkStream:
        key = host.lower().rstrip(".")
        target = self._host_ip.get(key, host)
        if target != host:
            try:
                ip = ipaddress.ip_address(target.split("%")[0])
            except ValueError as e:
                raise UrlSafetyError("Ziel-IP ist nicht öffentlich erreichbar") from e
            if _is_blocked_ip(ip):
                raise UrlSafetyError("Ziel-IP ist nicht öffentlich erreichbar")
        return await self._inner.connect_tcp(
            target,
            port,
            timeout=timeout,
            local_address=local_address,
            socket_options=socket_options,
        )

    async def connect_unix_socket(
        self,
        path: str,
        timeout: float | None = None,
        socket_options: list | None = None,
    ) -> httpcore.AsyncNetworkStream:
        return await self._inner.connect_unix_socket(
            path, timeout=timeout, socket_options=socket_options
        )

    async def sleep(self, seconds: float) -> None:
        await self._inner.sleep(seconds)


def dns_pinned_async_transport(host: str, ip: str, **kwargs: object) -> httpx.AsyncHTTPTransport:
    transport = httpx.AsyncHTTPTransport(**kwargs)
    inner = transport._pool._network_backend
    transport._pool._network_backend = HostPinnedAsyncBackend(inner, {host: ip})
    return transport


def _pinned_async_client(
    url: str,
    *,
    timeout: float,
    headers: Optional[dict] = None,
    cookies: httpx.Cookies | None = None,
) -> httpx.AsyncClient:
    host = (urlparse(url).hostname or "").lower().rstrip(".")
    ip = choose_connect_ip(resolve_public_ips(host))
    return httpx.AsyncClient(
        transport=dns_pinned_async_transport(host, ip),
        follow_redirects=False,
        timeout=timeout,
        headers=headers or {},
        cookies=cookies,
    )


def assert_public_http_url(
    url: str,
    *,
    require_https: bool = True,
    resolve_dns: bool = True,
) -> str:
    """Validiert URL gegen SSRF. Gibt bereinigte URL zurück oder wirft UrlSafetyError."""
    if not url or not isinstance(url, str):
        raise UrlSafetyError("URL fehlt")
    raw = url.strip()
    if len(raw) > MAX_URL_LENGTH:
        raise UrlSafetyError("URL zu lang")

    parsed = urlparse(raw)
    if parsed.scheme not in ("http", "https"):
        raise UrlSafetyError("Nur http(s)-URLs sind erlaubt")
    if parsed.username or parsed.password:
        raise UrlSafetyError("URL mit Zugangsdaten ist nicht erlaubt")

    host = (parsed.hostname or "").lower().rstrip(".")
    _assert_host_and_scheme(host, parsed.scheme, require_https=require_https)

    if resolve_dns:
        _assert_resolves_public(host)
    return raw


async def assert_no_unsafe_redirect(url: str, *, require_https: bool = False) -> None:
    """Verfolgt die HTTP-Redirect-Kette (ohne den Body zu lesen) und prüft
    JEDEN Hop erneut gegen SSRF-Regeln - Schutz gegen öffentliche Domains,
    die serverseitig auf ein privates/internes Ziel umleiten.

    Best-effort/defense-in-depth: Netzwerkfehler (Timeout, Verbindungsabbruch,
    Anti-Bot-Block auf HTTP-Ebene) werden bewusst NICHT als Sicherheitsfehler
    gewertet (sonst würden bereits bekannte, bot-geschützte Portale wie
    Immowelt/ImmoScout hier fälschlich blockiert) - nur ein tatsächlich
    aufgelöster, unsicherer Redirect-Zielhost schlägt fehl. Der eigentliche
    Fetch validiert die Ursprungs-URL ohnehin bereits per
    `assert_public_http_url()`."""
    current = url
    try:
        for _ in range(MAX_REDIRECT_HOPS):
            assert_public_http_url(current, require_https=require_https)
            try:
                async with _pinned_async_client(
                    current, timeout=REDIRECT_CHECK_TIMEOUT_SEC
                ) as client:
                    async with client.stream("GET", current) as resp:
                        status_code = resp.status_code
                        location = resp.headers.get("location")
            except httpx.HTTPError as e:
                logger.debug(f"Redirect-Check abgebrochen (Netzwerk) für {current}: {e}")
                return
            if status_code not in (301, 302, 303, 307, 308) or not location:
                return
            current = urljoin(current, location)
    except UrlSafetyError:
        raise
    except Exception as e:
        logger.debug(f"Redirect-Check fehlgeschlagen (best-effort) für {url}: {e}")


def assert_analyse_listing_url(url: str) -> str:
    """Custom-URL-Analyse: jede öffentliche https-Property-URL, keine feste
    Portal-Allowlist mehr (Phase 2 - generische Website-Unterstützung)."""
    return assert_public_http_url(url, require_https=True)


def assert_image_fetch_url(url: str) -> Optional[str]:
    """Bild-URLs: öffentlich, aber ohne Portal-Allowlist (CDN-Hosts)."""
    try:
        return assert_public_http_url(url, require_https=False)
    except UrlSafetyError:
        return None


ZVG_PORTAL_HOSTS = frozenset({"zvg-portal.de", "www.zvg-portal.de"})
HANMARK_HOSTS = frozenset({"hanmark.de", "www.hanmark.de"})
ZVG_COM_HOSTS = frozenset({"zvg.com", "www.zvg.com"})
ZVG_DOCUMENT_HOSTS = ZVG_PORTAL_HOSTS | HANMARK_HOSTS | ZVG_COM_HOSTS
_REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})
_REDIRECT_TO_GET = frozenset({301, 302, 303})
_SAFE_HTTP_METHODS = frozenset({"GET", "POST", "HEAD"})


def assert_allowed_https_host(
    url: str,
    hosts: frozenset[str],
    *,
    resolve_dns: bool = True,
) -> str:
    clean = assert_public_http_url(url, require_https=True, resolve_dns=resolve_dns)
    host = (urlparse(clean).hostname or "").lower().rstrip(".")
    if host not in hosts:
        raise UrlSafetyError("Ziel-Host ist nicht erlaubt")
    return clean


def assert_zvg_portal_document_url(url: str, *, resolve_dns: bool = True) -> str:
    """PDF-Anhänge und Detailseiten: öffentlich, https, nur zvg-portal.de."""
    return assert_allowed_https_host(url, ZVG_PORTAL_HOSTS, resolve_dns=resolve_dns)


def assert_hanmark_url(url: str, *, resolve_dns: bool = True) -> str:
    """Hanmark-Detailseiten: öffentlich, https, nur hanmark.de."""
    return assert_allowed_https_host(url, HANMARK_HOSTS, resolve_dns=resolve_dns)


def assert_zvg_com_url(url: str, *, resolve_dns: bool = True) -> str:
    """zvg.com-Asset-URLs: öffentlich, https, nur zvg.com."""
    return assert_allowed_https_host(url, ZVG_COM_HOSTS, resolve_dns=resolve_dns)


def assert_zvg_document_url(url: str, *, resolve_dns: bool = True) -> str:
    """Gutachten/Exposé: öffentlich, https, nur Portal-Hosts."""
    return assert_allowed_https_host(url, ZVG_DOCUMENT_HOSTS, resolve_dns=resolve_dns)


def _assert_fetch_url(
    url: str,
    *,
    require_https: bool,
    allowed_hosts: frozenset[str] | None,
) -> str:
    if allowed_hosts is not None:
        return assert_allowed_https_host(url, allowed_hosts, resolve_dns=True)
    return assert_public_http_url(url, require_https=require_https, resolve_dns=True)


async def fetch_public_request(
    method: str,
    url: str,
    *,
    timeout_sec: float = 30.0,
    headers: Optional[dict] = None,
    require_https: bool = True,
    allowed_hosts: frozenset[str] | None = None,
    cookies: httpx.Cookies | None = None,
    data: object | None = None,
    json: object | None = None,
    params: object | None = None,
    content: bytes | None = None,
    respect_robots: bool | None = None,
) -> httpx.Response:
    """GET/POST/HEAD mit hop-weiser SSRF-Prüfung, optionaler Host-Allowlist und
    robots.txt-Prüfung (Standard: an, abschaltbar über RESPECT_ROBOTS_TXT=false)."""
    verb = method.upper()
    check_robots = robots.enabled() if respect_robots is None else respect_robots
    if verb not in _SAFE_HTTP_METHODS:
        raise UrlSafetyError("HTTP-Methode nicht erlaubt")

    current = _assert_fetch_url(url, require_https=require_https, allowed_hosts=allowed_hosts)
    send_data = data
    send_json = json
    send_content = content
    send_params = params
    jar = cookies if cookies is not None else httpx.Cookies()

    for _ in range(MAX_REDIRECT_HOPS + 1):
        current = _assert_fetch_url(
            current, require_https=require_https, allowed_hosts=allowed_hosts
        )
        if check_robots and not await robots.is_allowed(current):
            logger.info(f"robots.txt untersagt den Abruf: {log_safe_url(current)}")
            raise RobotsDisallowedError("Abruf laut robots.txt nicht erlaubt")
        request_kwargs: dict[str, object] = {}
        if send_params is not None:
            request_kwargs["params"] = send_params
        if send_data is not None:
            request_kwargs["data"] = send_data
        if send_json is not None:
            request_kwargs["json"] = send_json
        if send_content is not None:
            request_kwargs["content"] = send_content

        async with _pinned_async_client(current, timeout=timeout_sec, headers=headers) as client:
            client.cookies.update(jar)
            resp = await client.request(verb, current, **request_kwargs)
            jar.update(client.cookies)

        if resp.status_code not in _REDIRECT_STATUSES:
            return resp
        location = resp.headers.get("location")
        if not location:
            return resp
        current = urljoin(str(resp.request.url), location)
        send_params = None
        if resp.status_code in _REDIRECT_TO_GET:
            verb = "GET"
            send_data = None
            send_json = None
            send_content = None
    raise UrlSafetyError("Zu viele Redirects")


async def fetch_public_url(
    url: str,
    *,
    timeout_sec: float = 30.0,
    headers: Optional[dict] = None,
    require_https: bool = False,
    allowed_hosts: frozenset[str] | None = None,
    cookies: httpx.Cookies | None = None,
) -> httpx.Response:
    """GET mit hop-weiser SSRF-Prüfung. Folgt Redirects nicht blind."""
    return await fetch_public_request(
        "GET",
        url,
        timeout_sec=timeout_sec,
        headers=headers,
        require_https=require_https,
        allowed_hosts=allowed_hosts,
        cookies=cookies,
    )
