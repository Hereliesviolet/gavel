"""
Rate-Limits und Domain-Cooldowns für Custom-URL-Scraping (TEIL 2h).

Schützt die feste Server-IP vor Portal-Sperren.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass

import redis as redis_lib

from src.utils.scrape_domains import normalize_domain

MIN_INTERVAL_SEC = int(os.environ.get("SCRAPE_MIN_INTERVAL_PER_DOMAIN_SEC", "8"))
MAX_PER_DOMAIN_HOUR = int(os.environ.get("SCRAPE_MAX_PER_DOMAIN_HOUR", "30"))
MAX_GLOBAL_HOUR = int(os.environ.get("SCRAPE_MAX_GLOBAL_HOUR", "60"))
COOLDOWN_SECONDS = int(os.environ.get("SCRAPE_COOLDOWN_SECONDS", "3600"))

# Getrennte Kontingente: eine nächtliche Massenernte darf das Budget der
# nutzerausgelösten Analyse nicht aufbrauchen. Domain-Cooldown und
# Mindestintervall gelten weiterhin für alle gemeinsam, denn die schützen das
# Portal, nicht uns.
KONTINGENT_INTERAKTIV = "interaktiv"
KONTINGENT_ERNTE = "ernte"
MAX_ERNTE_PER_DOMAIN_HOUR = int(os.environ.get("SCRAPE_MAX_ERNTE_PER_DOMAIN_HOUR", "120"))
RATE_LIMIT_USER_MESSAGE = (
    "Dieses Portal hat den Zugriff vorübergehend eingeschränkt. Bitte später erneut versuchen."
)

_redis: redis_lib.Redis | None = None


@dataclass
class RateLimitError(Exception):
    code: str
    message: str
    retry_after_sec: int

    def __str__(self) -> str:
        return self.message


def _client() -> redis_lib.Redis:
    global _redis
    if _redis is None:
        _redis = redis_lib.from_url(
            os.environ.get("REDIS_URL", "redis://localhost:6379"),
            decode_responses=True,
        )
    return _redis


def _interval_key(domain: str) -> str:
    return f"gavel:scrape-interval:{domain}"


def _hour_domain_key(domain: str, kontingent: str = KONTINGENT_INTERAKTIV) -> str:
    if kontingent == KONTINGENT_INTERAKTIV:
        return f"gavel:scrape-hour-domain:{domain}"
    return f"gavel:scrape-hour-domain:{kontingent}:{domain}"


def _hour_global_key() -> str:
    return "gavel:scrape-hour-global"


def _cooldown_key(domain: str) -> str:
    return f"gavel:scrape-cooldown:{domain}"


def get_cooldown_remaining(domain: str) -> int:
    ttl = _client().ttl(_cooldown_key(domain))
    return max(0, int(ttl)) if ttl and ttl > 0 else 0


def set_domain_cooldown(domain: str, seconds: int = COOLDOWN_SECONDS) -> None:
    _client().setex(_cooldown_key(domain), seconds, "1")


def clear_domain_cooldown(domain: str) -> None:
    _client().delete(_cooldown_key(domain))


def check_rate_limits(url: str, kontingent: str = KONTINGENT_INTERAKTIV) -> None:
    domain = normalize_domain(url)
    r = _client()

    remaining = get_cooldown_remaining(domain)
    if remaining > 0:
        minutes = max(1, remaining // 60)
        raise RateLimitError(
            code="BOT_BLOCKED_COOLDOWN",
            message=(
                "Dieses Portal hat den automatischen Zugriff vorübergehend eingeschränkt. "
                f"Bitte in ca. {minutes} Minuten erneut versuchen oder die Original-URL manuell öffnen."
            ),
            retry_after_sec=remaining,
        )

    last = r.get(_interval_key(domain))
    if last:
        elapsed = time.time() - float(last)
        if elapsed < MIN_INTERVAL_SEC:
            wait = int(MIN_INTERVAL_SEC - elapsed) + 1
            raise RateLimitError(
                code="SCRAPE_RATE_LIMITED",
                message=f"Bitte {wait} Sekunden warten, bevor dieselbe Domain erneut abgefragt wird.",
                retry_after_sec=wait,
            )

    limit = (
        MAX_PER_DOMAIN_HOUR if kontingent == KONTINGENT_INTERAKTIV else MAX_ERNTE_PER_DOMAIN_HOUR
    )
    if int(r.get(_hour_domain_key(domain, kontingent)) or 0) >= limit:
        raise RateLimitError(
            code="SCRAPE_RATE_LIMITED",
            message=RATE_LIMIT_USER_MESSAGE,
            retry_after_sec=3600,
        )

    if kontingent != KONTINGENT_INTERAKTIV:
        return

    if int(r.get(_hour_global_key()) or 0) >= MAX_GLOBAL_HOUR:
        raise RateLimitError(
            code="SCRAPE_RATE_LIMITED",
            message=(
                f"Globales Stundenlimit für Custom-URL-Analysen erreicht ({MAX_GLOBAL_HOUR}/h). "
                "Bitte später erneut versuchen."
            ),
            retry_after_sec=3600,
        )


def record_scrape_attempt(url: str, kontingent: str = KONTINGENT_INTERAKTIV) -> None:
    domain = normalize_domain(url)
    r = _client()
    now = time.time()
    r.setex(_interval_key(domain), MIN_INTERVAL_SEC * 2, str(now))

    domain_key = _hour_domain_key(domain, kontingent)
    count = r.incr(domain_key)
    if count == 1:
        r.expire(domain_key, 3600)

    if kontingent != KONTINGENT_INTERAKTIV:
        return

    global_key = _hour_global_key()
    gcount = r.incr(global_key)
    if gcount == 1:
        r.expire(global_key, 3600)
