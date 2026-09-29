"""robots.txt check for outbound page requests.

Follows RFC 9309 in the simple cases: a missing robots.txt (4xx) allows
everything, an unreachable one (5xx, network error) disallows everything for
the moment, and the rules of the `Gavel` product token (or `*`) apply. Results
are cached per origin for one hour. Set RESPECT_ROBOTS_TXT=false to switch the
check off, for example in tests or when crawling your own site.
"""

from __future__ import annotations

import os
import time
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

from loguru import logger

from src.utils.user_agent import PRODUCT_TOKEN, user_agent

CACHE_TTL_SECONDS = 3600
FETCH_TIMEOUT_SECONDS = 6.0
MAX_ROBOTS_BYTES = 512 * 1024

# origin -> (expires_at, parser or None; None means "disallow everything")
_cache: dict[str, tuple[float, RobotFileParser | None]] = {}


def enabled() -> bool:
    return os.environ.get("RESPECT_ROBOTS_TXT", "true").strip().lower() not in ("0", "false", "no")


def clear_cache() -> None:
    _cache.clear()


def _origin(url: str) -> str | None:
    parsed = urlparse(url)
    if not parsed.scheme or not parsed.hostname:
        return None
    return f"{parsed.scheme}://{parsed.netloc}"


def _parse(body: str) -> RobotFileParser:
    parser = RobotFileParser()
    parser.parse(body.splitlines())
    return parser


async def _load(origin: str) -> RobotFileParser | None:
    # Imported lazily: url_safety calls into this module.
    from src.utils.url_safety import fetch_public_request

    try:
        resp = await fetch_public_request(
            "GET",
            f"{origin}/robots.txt",
            timeout_sec=FETCH_TIMEOUT_SECONDS,
            headers={"User-Agent": user_agent()},
            require_https=origin.startswith("https://"),
            respect_robots=False,
        )
    except Exception as exc:
        logger.warning(f"robots.txt nicht abrufbar ({origin}): {exc}; Zugriff wird ausgesetzt")
        return None
    if 400 <= resp.status_code < 500:
        return _parse("")
    if resp.status_code >= 500:
        logger.warning(f"robots.txt Serverfehler {resp.status_code} ({origin}); Zugriff ausgesetzt")
        return None
    return _parse(resp.text[:MAX_ROBOTS_BYTES])


async def is_allowed(url: str) -> bool:
    origin = _origin(url)
    if origin is None:
        return True
    now = time.monotonic()
    cached = _cache.get(origin)
    if cached is None or cached[0] <= now:
        cached = (now + CACHE_TTL_SECONDS, await _load(origin))
        _cache[origin] = cached
    parser = cached[1]
    if parser is None:
        return False
    return parser.can_fetch(PRODUCT_TOKEN, url)
