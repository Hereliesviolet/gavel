"""Timing-sichere Bearer-Vergleiche ohne Exception bei ungleicher Länge."""

from __future__ import annotations

import secrets
from typing import Optional


def bearer_matches(authorization: Optional[str], secret: Optional[str]) -> bool:
    if not secret or not authorization:
        return False
    expected = f"Bearer {secret}".encode("utf-8")
    provided = authorization.encode("utf-8")
    if len(provided) != len(expected):
        return False
    return secrets.compare_digest(provided, expected)
