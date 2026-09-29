"""Honest User-Agent for all outbound requests of the scrapers.

The agent names the project and, if CONTACT_INFO is set (an e-mail address or a
project URL), a contact so that site operators can reach whoever runs it.
"""

from __future__ import annotations

import os

PRODUCT_TOKEN = "Gavel"
PRODUCT_VERSION = "1.0"


def user_agent() -> str:
    contact = os.environ.get("CONTACT_INFO", "").strip()
    base = f"{PRODUCT_TOKEN}/{PRODUCT_VERSION}"
    return f"{base} (+{contact})" if contact else base


def default_headers(extra: dict[str, str] | None = None) -> dict[str, str]:
    headers = {"User-Agent": user_agent(), "Accept-Language": "de-DE,de;q=0.9,en;q=0.5"}
    if extra:
        headers.update(extra)
    return headers
