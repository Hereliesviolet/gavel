"""Optionaler Sentry-Hook. Ohne SENTRY_DSN ein No-Op."""

from __future__ import annotations

import os
import traceback
import uuid
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urlparse

import httpx
from loguru import logger


def parse_sentry_dsn(dsn: Optional[str]) -> Optional[dict[str, str]]:
    if not dsn or not dsn.strip():
        return None
    parsed = urlparse(dsn.strip())
    project_id = (parsed.path or "").strip("/").split("/")[0]
    if not parsed.username or not parsed.hostname or not project_id:
        return None
    host = parsed.hostname if parsed.port is None else f"{parsed.hostname}:{parsed.port}"
    return {
        "public_key": parsed.username,
        "host": host,
        "project_id": project_id,
        "store_url": f"{parsed.scheme}://{host}/api/{project_id}/store/",
    }


def sanitize_sentry_extra(extra: dict[str, Any] | None) -> dict[str, Any]:
    if not extra:
        return {}
    from src.utils.url_safety import log_safe_url

    cleaned: dict[str, Any] = {}
    for key, value in extra.items():
        if isinstance(value, str) and (
            "url" in key.lower() or value.startswith("http://") or value.startswith("https://")
        ):
            cleaned[key] = log_safe_url(value)
        else:
            cleaned[key] = value
    return cleaned


def capture_exception(
    error: BaseException, *, path: str | None = None, extra: dict[str, Any] | None = None
) -> None:
    parsed = parse_sentry_dsn(os.environ.get("SENTRY_DSN"))
    if not parsed:
        return
    event = {
        "event_id": uuid.uuid4().hex,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "platform": "python",
        "level": "error",
        "logger": "gavel-scraper",
        "server_name": os.environ.get("DOMAIN", "gavel"),
        "exception": {
            "values": [
                {
                    "type": type(error).__name__,
                    "value": str(error)[:2000],
                    "stacktrace": {
                        "frames": [
                            {"filename": line.strip()[:500]}
                            for line in traceback.format_exception(error)[-20:]
                        ]
                    },
                }
            ]
        },
        "extra": {"path": path, **sanitize_sentry_extra(extra)},
        "tags": {"app": "scraper"},
    }
    headers = {
        "Content-Type": "application/json",
        "X-Sentry-Auth": (
            f"Sentry sentry_version=7, sentry_client=gavel-scraper/1.0, "
            f"sentry_key={parsed['public_key']}"
        ),
    }
    try:
        httpx.post(parsed["store_url"], json=event, headers=headers, timeout=4.0)
    except Exception as e:
        logger.warning(f"Sentry-Event konnte nicht gesendet werden: {e}")
