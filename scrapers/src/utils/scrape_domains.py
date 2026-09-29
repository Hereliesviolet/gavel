"""Domain helpers for rate limiting and per-domain bookkeeping."""

from __future__ import annotations

from urllib.parse import urlparse


def normalize_domain(url: str) -> str:
    host = (urlparse(url).hostname or "").lower().removeprefix("www.")
    if not host:
        return "unknown"
    parts = host.split(".")
    if len(parts) >= 2:
        return ".".join(parts[-2:])
    return host
