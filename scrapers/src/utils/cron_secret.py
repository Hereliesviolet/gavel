"""Audience-Secrets analog zu apps/web/lib/cron-auth.ts.

Ist das scoped Secret gesetzt, gilt nur dieses. Sonst Fallback auf CRON_SECRET.
"""

from __future__ import annotations

import os
from typing import Optional


def cron_secret_for_audience(
    scoped_env: str,
    fallback_env: str = "CRON_SECRET",
    environ: Optional[dict[str, str]] = None,
) -> Optional[str]:
    env = os.environ if environ is None else environ
    scoped = (env.get(scoped_env) or "").strip()
    if scoped:
        return scoped
    fallback = (env.get(fallback_env) or "").strip()
    return fallback or None
