from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from loguru import logger

from src.storage.postgres import get_connection, release_connection


def scrape_job_status(result: Optional[dict[str, Any]]) -> str:
    if not result:
        return "error"
    if result.get("error"):
        return "error"
    reason = str(result.get("reason") or "")
    if result.get("skipped") and "SECRET" in reason.upper():
        return "error"
    return "success"


def scrape_job_counts(
    result: Optional[dict[str, Any]],
    found_key: str,
    *,
    new_key: str = "items_new",
    updated_key: str = "items_updated",
    failed_key: str = "failed",
) -> tuple[int, int, int, int]:
    data = result or {}
    found = int(data.get(found_key, 0) or 0)
    failed = 1 if data.get("error") else int(data.get(failed_key, 0) or 0)
    new = int(data.get(new_key, 0) or 0) if new_key in data else 0
    updated = int(data.get(updated_key, 0) or 0) if updated_key in data else 0
    return found, new, updated, failed


async def record_scrape_job(
    *,
    flow_name: str,
    job_type: str = "daily",
    status: str,
    items_found: int = 0,
    items_new: int = 0,
    items_updated: int = 0,
    items_failed: int = 0,
    error_message: Optional[str] = None,
    prefect_run_id: Optional[str] = None,
    started_at: Optional[datetime] = None,
) -> None:
    conn = await get_connection()
    try:
        await conn.execute(
            """
            INSERT INTO scrape_jobs (
              flow_name, job_type, status,
              items_found, items_new, items_updated, items_failed,
              error_message, prefect_run_id, started_at, completed_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            """,
            flow_name,
            job_type,
            status,
            items_found,
            items_new,
            items_updated,
            items_failed,
            error_message,
            prefect_run_id,
            started_at,
            datetime.now(timezone.utc).replace(tzinfo=None),
        )
        await conn.execute(
            """
            DELETE FROM scrape_jobs
            WHERE completed_at < NOW() - INTERVAL '90 days'
            """
        )
    finally:
        await release_connection(conn)


async def step_succeeded_today(flow_name: str) -> bool:
    conn = await get_connection()
    try:
        return bool(
            await conn.fetchval(
                """
                SELECT EXISTS (
                  SELECT 1
                  FROM scrape_jobs
                  WHERE flow_name = $1
                    AND status = 'success'
                    AND completed_at >= (
                      date_trunc('day', timezone('Europe/Berlin', now()))
                      AT TIME ZONE 'Europe/Berlin'
                    )
                )
                """,
                flow_name,
            )
        )
    finally:
        await release_connection(conn)


async def record_scrape_job_safe(
    flow_name: str,
    result: Optional[dict[str, Any]],
    *,
    found_key: str = "total_stored",
    new_key: str = "items_new",
    updated_key: str = "items_updated",
    prefect_run_id: Optional[str] = None,
) -> None:
    try:
        found, new, updated, failed = scrape_job_counts(
            result, found_key, new_key=new_key, updated_key=updated_key
        )
        await record_scrape_job(
            flow_name=flow_name,
            status=scrape_job_status(result),
            items_found=found,
            items_new=new,
            items_updated=updated,
            items_failed=failed,
            error_message=str(result.get("error")) if result and result.get("error") else None,
            prefect_run_id=prefect_run_id,
        )
    except Exception as e:
        logger.error(f"scrape_jobs konnte nicht geschrieben werden ({flow_name}): {e}")
