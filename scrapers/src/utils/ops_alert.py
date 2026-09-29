from __future__ import annotations

import os

import httpx
from loguru import logger

from src.utils.cron_secret import cron_secret_for_audience

INTERNAL_API_URL = os.environ.get("INTERNAL_API_URL", "http://web:3000")


async def post_ops_alert(*, alertname: str, summary: str) -> None:
    secret = cron_secret_for_audience("CRON_OPS_SECRET")
    if not secret:
        logger.warning("ops-alert übersprungen: CRON_OPS_SECRET/CRON_SECRET fehlt")
        return
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{INTERNAL_API_URL}/api/cron/ops-alert",
                headers={"Authorization": f"Bearer {secret}"},
                json={
                    "status": "firing",
                    "alerts": [
                        {
                            "status": "firing",
                            "labels": {"alertname": alertname[:80]},
                            "annotations": {"summary": summary[:500]},
                        }
                    ],
                },
            )
        if resp.status_code != 200:
            logger.warning(f"ops-alert fehlgeschlagen (HTTP {resp.status_code}): {resp.text[:300]}")
    except Exception as exc:
        logger.warning(f"ops-alert fehlgeschlagen: {exc}")
