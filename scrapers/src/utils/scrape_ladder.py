"""Fetching for the custom-URL analysis.

`fetch_page_resilient` performs a plain HTTP GET (no JavaScript, no browser),
after rate limits, DNS and SSRF checks and the robots.txt check. It does not try
to get around bot protection: when the answer looks like a challenge page,
a login wall or an access block, the domain goes into a cooldown and the result
tells the user to paste the page source or upload a PDF instead.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Optional
from urllib.parse import urlparse

from loguru import logger

from src.utils.content_price import angebotstyp_aus_text, preis_aus_text
from src.utils.page_fetch import extract_links, fetch_html, html_to_markdown
from src.utils.scrape_domains import normalize_domain
from src.utils.scrape_rate_limit import (
    KONTINGENT_INTERAKTIV,
    RATE_LIMIT_USER_MESSAGE,
    RateLimitError,
    check_rate_limits,
    record_scrape_attempt,
    set_domain_cooldown,
)
from src.utils.url_safety import (
    UrlSafetyError,
    assert_public_http_url,
    log_safe_url,
    normalize_listing_url,
    public_url_safety_message,
    resolve_public_ips,
    url_safety_error_code,
)

ProgressCallback = Optional[Callable[[str], Awaitable[None]]]

MIN_MARKDOWN_CHARS = 100
BOT_WALL_MARKERS = (
    "captcha",
    "recaptcha",
    "hcaptcha",
    "access denied",
    "bot detected",
    "automated access",
    "ungewöhnlichen datenverkehr",
    "unusual traffic",
    "are you a robot",
    "bist du ein roboter",
)
LOGIN_WALL_MARKERS = (
    "anmelden",
    "einloggen",
    "sign in",
    "log in",
    "login",
)

# Strong markers: also count for long pages, for example a challenge page with
# more than 1000 characters of body text. Bare "recaptcha" is deliberately not
# in this list: ordinary portal pages often load reCAPTCHA scripts without
# being a challenge; those strings only count for very short content.
STRONG_BOT_WALL_MARKERS = (
    "ich bin kein roboter",
    "i am not a robot",
    "kein roboter",
    "gleich geht's weiter",
    "gleich gehts weiter",
    "wir überprüfen schnell",
    "wir überprüfen, dass du kein roboter",
    "security check",
    "challenge-platform",
)


@dataclass
class ScrapeMetadata:
    domain: str
    scrape_duration_ms: int = 0
    bot_wall: bool = False
    bot_wall_reason: Optional[str] = None
    error_code: Optional[str] = None
    fetch_source: str = "http"
    session_cookie_used: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "domain": self.domain,
            "scrape_duration_ms": self.scrape_duration_ms,
            "bot_wall": self.bot_wall,
            "bot_wall_reason": self.bot_wall_reason,
            "error_code": self.error_code,
            "fetch_source": self.fetch_source,
            "session_cookie_used": self.session_cookie_used,
        }


@dataclass
class ResilientScrapeResult:
    url: str
    markdown: str = ""
    raw_html: str = ""
    links: list[str] = field(default_factory=list)
    status_code: int | None = None
    success: bool = False
    error: str | None = None
    error_code: str | None = None
    metadata: ScrapeMetadata | None = None


def detect_bot_wall(markdown: str, html: str, status_code: int | None) -> tuple[bool, str, str]:
    text = (html or "").lower()
    md = (markdown or "").lower()
    combined = f"{text}\n{md}"
    md_len = len((markdown or "").strip())

    if status_code in (401, 403, 429, 503):
        return True, "high", f"http_{status_code}"

    for marker in STRONG_BOT_WALL_MARKERS:
        if marker in combined:
            return True, "high", f"strong_marker:{marker}"

    if md_len < 200:
        for marker in BOT_WALL_MARKERS:
            if marker in text:
                return True, "high", f"short_content:{marker}"
        for marker in LOGIN_WALL_MARKERS:
            if marker in combined:
                return True, "high", f"login_wall:{marker}"

    return False, "low", ""


def body_has_expose(markdown: str, html: str) -> bool:
    """Body gilt als Exposé, wenn Typ oder beschrifteter Preis erkennbar ist."""
    text = f"{html or ''}\n{markdown or ''}"
    if angebotstyp_aus_text(text):
        return True
    return preis_aus_text(text, nur_beschriftet=True) is not None


def login_wall_without_expose(markdown: str, html: str) -> bool:
    """Lange Login-Seiten ohne Exposé-Beweis — nicht als Scrape-Erfolg werten."""
    combined = f"{(html or '').lower()}\n{(markdown or '').lower()}"
    if not any(marker in combined for marker in LOGIN_WALL_MARKERS):
        return False
    return not body_has_expose(markdown, html)


async def _check_domain_resolvable(url: str, timeout_sec: float = 5.0) -> bool:
    """Prüft die DNS-Auflösung vor dem Abruf, damit ein Tippfehler in der URL als
    Konnektivitätsproblem gemeldet wird und nicht als Sperre der Zielseite."""
    host = urlparse(url).hostname
    if not host:
        return False
    loop = asyncio.get_running_loop()
    try:
        await asyncio.wait_for(
            loop.run_in_executor(None, resolve_public_ips, host),
            timeout=timeout_sec,
        )
        return True
    except (UrlSafetyError, OSError, asyncio.TimeoutError):
        return False


async def _emit_progress(on_progress: ProgressCallback, message: str) -> None:
    if not on_progress:
        return
    try:
        await on_progress(message[:120])
    except Exception as e:
        logger.debug(f"on_progress fehlgeschlagen: {e}")


_COOKIE_SESSION_MESSAGE = (
    "Mit dem eingefügten Cookie war kein Zugriff möglich (Login-Sperre oder "
    "abgelaufene Sitzung erkannt). Bitte einen aktuellen Cookie-Wert aus einem "
    "eingeloggten Browser-Tab einfügen."
)


async def fetch_page_resilient(
    url: str,
    timeout_ms: int = 45000,
    on_progress: ProgressCallback = None,
    kontingent: str = KONTINGENT_INTERAKTIV,
    extra_cookies: Optional[list[dict[str, Any]]] = None,
) -> ResilientScrapeResult:
    """Ruft eine Seite per einfachem HTTP-GET ab.

    `extra_cookies`: vom Nutzer ausdrücklich eingefügte Session-Cookies für ein
    login-geschütztes Angebot. Sie gelten nur für diesen einen Abruf und Zielhost
    und werden weder gespeichert noch geloggt.

    Seiten mit Bot-Schutz, Challenge- oder Login-Wand werden nicht umgangen: das
    Ergebnis ist `BOT_BLOCKED` (mit Domain-Cooldown) bzw. `SCRAPE_INSUFFICIENT`.
    """
    started = time.monotonic()
    clean_url = normalize_listing_url(url)
    if clean_url != url:
        logger.info(f"URL normalisiert für Fetch: {log_safe_url(url)} → {log_safe_url(clean_url)}")
        url = clean_url
    domain = normalize_domain(url)
    with_cookies = bool(extra_cookies)
    metadata = ScrapeMetadata(domain=domain, session_cookie_used=with_cookies)
    await _emit_progress(on_progress, f"Fetch · {domain}")

    try:
        check_rate_limits(url, kontingent)
    except RateLimitError as exc:
        metadata.error_code = exc.code
        await _emit_progress(on_progress, f"Rate-Limit · {exc.code}")
        return ResilientScrapeResult(
            url=url,
            success=False,
            error=RATE_LIMIT_USER_MESSAGE,
            error_code=exc.code,
            metadata=metadata,
        )

    if not await _check_domain_resolvable(url):
        metadata.error_code = "CONNECTIVITY_FAILED"
        await _emit_progress(on_progress, "DNS fehlgeschlagen")
        return ResilientScrapeResult(
            url=url,
            success=False,
            error=(
                "Diese Domain ist nicht erreichbar (DNS-Auflösung fehlgeschlagen). "
                "Bitte die URL auf Tippfehler prüfen."
            ),
            error_code="CONNECTIVITY_FAILED",
            metadata=metadata,
        )

    await _emit_progress(
        on_progress,
        "Eingefügte Sitzung · Seite wird geladen…" if with_cookies else "Seite wird geladen…",
    )

    try:
        url = assert_public_http_url(url, require_https=True, resolve_dns=True)
        data = await fetch_html(url, cookies=extra_cookies, timeout_ms=timeout_ms)
    except UrlSafetyError as exc:
        error_code = url_safety_error_code(exc)
        metadata.error_code = error_code
        await _emit_progress(
            on_progress,
            {
                "CONNECTIVITY_FAILED": "DNS fehlgeschlagen",
                "ROBOTS_DISALLOWED": "robots.txt untersagt den Abruf",
            }.get(error_code, "URL blockiert"),
        )
        logger.warning(f"URL-Sicherheit: {log_safe_url(url)} ({exc})")
        return ResilientScrapeResult(
            url=url,
            success=False,
            error=public_url_safety_message(exc),
            error_code=error_code,
            metadata=metadata,
        )

    raw_html = data.get("content") or ""
    status_code = data.get("pageStatusCode")
    if data.get("pageError") or status_code is None:
        logger.warning(f"Fetch fehlgeschlagen ({log_safe_url(url)}): {data.get('pageError')}")
        await _emit_progress(on_progress, "Abruf fehlgeschlagen")
        metadata.error_code = "SCRAPE_FAILED"
        return ResilientScrapeResult(
            url=url,
            success=False,
            error="Seite konnte nicht geladen werden.",
            error_code="SCRAPE_FAILED",
            metadata=metadata,
        )

    markdown = html_to_markdown(raw_html)
    links = extract_links(raw_html, url)
    bot_wall, _confidence, reason = detect_bot_wall(markdown, raw_html, status_code)
    metadata.scrape_duration_ms = int((time.monotonic() - started) * 1000)

    if bot_wall:
        logger.warning(
            f"Zugriffsschutz erkannt, Seite wird nicht abgerufen domain={domain} "
            f"reason={reason} status={status_code} html_chars={len(raw_html)} "
            f"markdown_chars={len(markdown)} cookies={with_cookies}"
        )
        await _emit_progress(on_progress, f"Bot-Wall · {reason}")
        metadata.bot_wall = True
        metadata.bot_wall_reason = reason
        if with_cookies:
            # The cookie belongs to one user: no domain cooldown for everyone else.
            metadata.error_code = "COOKIE_SESSION_INVALID"
            return ResilientScrapeResult(
                url=url,
                markdown=markdown,
                raw_html=raw_html,
                links=links,
                status_code=status_code,
                success=False,
                error=_COOKIE_SESSION_MESSAGE,
                error_code="COOKIE_SESSION_INVALID",
                metadata=metadata,
            )
        metadata.error_code = "BOT_BLOCKED"
        set_domain_cooldown(domain)
        return ResilientScrapeResult(
            url=url,
            markdown=markdown,
            raw_html=raw_html,
            links=links,
            status_code=status_code,
            success=False,
            error=(
                "Diese Seite schützt sich gegen automatischen Abruf und wird deshalb nicht "
                "geladen. Bitte die Seite über HTML-Einfügung oder PDF-Upload analysieren."
            ),
            error_code="BOT_BLOCKED",
            metadata=metadata,
        )

    login_only = login_wall_without_expose(markdown, raw_html)
    if len(markdown) < MIN_MARKDOWN_CHARS or login_only:
        if with_cookies and login_only:
            metadata.error_code = "COOKIE_SESSION_INVALID"
            await _emit_progress(on_progress, "Login-Sperre")
            return ResilientScrapeResult(
                url=url,
                markdown=markdown,
                raw_html=raw_html,
                links=links,
                status_code=status_code,
                success=False,
                error=_COOKIE_SESSION_MESSAGE,
                error_code="COOKIE_SESSION_INVALID",
                metadata=metadata,
            )
        metadata.error_code = "SCRAPE_INSUFFICIENT"
        await _emit_progress(on_progress, "Inhalt unzureichend")
        hint = (
            "Bitte einen aktuellen Cookie-Wert einfügen."
            if with_cookies
            else "Bitte eine andere URL versuchen oder die Seite über HTML-Einfügung/PDF-Upload analysieren."
        )
        return ResilientScrapeResult(
            url=url,
            markdown=markdown,
            raw_html=raw_html,
            links=links,
            status_code=status_code,
            success=False,
            error=(
                "Auf dieser Seite konnten keine verwertbaren Inhalte gefunden werden "
                f"(z.B. Seite benötigt JavaScript oder Login). {hint}"
            ),
            error_code="SCRAPE_INSUFFICIENT",
            metadata=metadata,
        )

    record_scrape_attempt(url, kontingent)
    metadata.fetch_source = "http"
    metadata.scrape_duration_ms = int((time.monotonic() - started) * 1000)
    logger.info(f"Scrape OK domain={domain} source=http markdown_chars={len(markdown)}")

    return ResilientScrapeResult(
        url=url,
        markdown=markdown,
        raw_html=raw_html,
        links=links,
        status_code=status_code,
        success=True,
        metadata=metadata,
    )
