"""
Prefect Flow: Tägliche Datenqualitätsprüfung + Report (2026-07-04)

Zwei Schritte:
  1. run_quality_checks_task(): wendet die zentrale Plausibilitäts-Engine
     (src/utils/data_quality.py) auf ALLE aktuell aktiven Listings an
     (nicht nur neue) und schreibt das Ergebnis nach
     zvg_listings.data_quality_flags / needs_review. Rein SQL-basiert, keine
     externen API-Calls - günstig genug, um jeden Tag über den kompletten
     aktiven Bestand (~680+ Objekte) zu laufen, statt nur neue Objekte zu
     prüfen. Das deckt auch Fälle ab, bei denen sich Regeln ändern oder ein
     Objekt durch nachträgliche manuelle Korrektur/Re-Scrape wieder auffällig
     wird.
  2. generate_data_quality_report_task(): aggregiert eine Tageszusammenfassung
     (Gesamtzahl, needs_review-Anzahl, Aufschlüsselung nach Quelle/Problemtyp),
     vergleicht sie mit dem Vortag (Trend), loggt sie strukturiert (sichtbar in
     den Prefect-Logs/im bestehenden Monitoring) und löst - sofern
     CRON_SECRET/INTERNAL_API_URL konfiguriert sind - den Versand eines
     HTML-E-Mail-Reports an ADMIN_EMAIL aus (analog zu check_alerts.py: die
     eigentliche E-Mail-Logik liegt bewusst in Next.js/lib/email.ts, siehe
     apps/web/app/api/cron/data-quality-report/route.ts, um die
     SMTP-Konfiguration nicht ein zweites Mal in Python zu duplizieren).

Läuft täglich als Schritt 6.5 der daily_pipeline (nach der KI-Analyse, vor der
Archivierung) - siehe daily_pipeline.py.
"""

import os

import httpx
from prefect import flow, task, get_run_logger

from src.storage.postgres import (
    get_active_listings_for_quality_check,
    update_data_quality_flags,
    get_data_quality_summary,
    save_data_quality_daily_stats,
    get_previous_data_quality_stats,
)
from src.utils.cron_secret import cron_secret_for_audience
from src.utils.data_quality import evaluate_listing, needs_review, flags_to_json

INTERNAL_API_URL = os.environ.get("INTERNAL_API_URL", "http://web:3000")


@task(name="run-quality-checks", retries=1, retry_delay_seconds=30)
async def run_quality_checks_task(batch_size: int = 500) -> dict:
    """Prüft alle aktiven Listings batchweise und schreibt die Flags zurück."""
    logger = get_run_logger()

    checked = 0
    flagged = 0
    offset = 0

    while True:
        batch = await get_active_listings_for_quality_check(batch_size=batch_size, offset=offset)
        if not batch:
            break

        for listing in batch:
            ki_row = listing.get("ki_analyse") or {}
            flags = evaluate_listing(listing, ki=ki_row)
            review = needs_review(flags)
            await update_data_quality_flags(str(listing["id"]), flags_to_json(flags), review)
            checked += 1
            if review:
                flagged += 1

        offset += batch_size
        if len(batch) < batch_size:
            break

    logger.info(
        f"Datenqualitätsprüfung: {checked} aktive Listings geprüft, {flagged} mit needs_review geflaggt."
    )
    return {"checked": checked, "flagged": flagged}


@task(name="generate-data-quality-report", retries=1, retry_delay_seconds=30)
async def generate_data_quality_report_task() -> dict:
    """Aggregiert + loggt die Tageszusammenfassung, sendet optional E-Mail-Report."""
    logger = get_run_logger()

    summary = await get_data_quality_summary()
    previous = await get_previous_data_quality_stats(days_back=1)
    await save_data_quality_daily_stats(summary)

    total_active = summary["total_active"]
    total_needs_review = summary["total_needs_review"]
    pct = (total_needs_review / total_active * 100) if total_active else 0.0

    trend_str = ""
    if previous:
        delta = total_needs_review - previous["total_needs_review"]
        sign = "+" if delta >= 0 else ""
        trend_str = f" (Vortag: {previous['total_needs_review']}, Δ {sign}{delta})"

    logger.info(
        f"=== Datenqualitäts-Report: {total_needs_review}/{total_active} aktive Objekte "
        f"({pct:.1f}%) mit needs_review{trend_str} ==="
    )
    logger.info(f"Nach Quelle: {summary['by_source']}")
    top_reasons = summary["by_reason"][:10]
    for r in top_reasons:
        logger.info(f"  Top-Problem: {r['field']} / {r['reason']}: {r['count']}x")

    email_result = {"sent": False, "reason": "not_attempted"}
    cron_secret = cron_secret_for_audience("CRON_OPS_SECRET")
    if cron_secret:
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(
                    f"{INTERNAL_API_URL}/api/cron/data-quality-report",
                    headers={"Authorization": f"Bearer {cron_secret}"},
                    json={
                        "summary": summary,
                        "previous": previous,
                    },
                )
            if resp.status_code == 200:
                email_result = resp.json()
                logger.info(f"Datenqualitäts-Report-E-Mail: {email_result}")
            else:
                logger.warning(
                    f"Datenqualitäts-Report-E-Mail fehlgeschlagen (HTTP {resp.status_code}): {resp.text[:300]}"
                )
                email_result = {"sent": False, "reason": f"http_{resp.status_code}"}
        except Exception as exc:
            logger.warning(f"Datenqualitäts-Report-E-Mail fehlgeschlagen: {exc}")
            email_result = {"sent": False, "reason": "Versand fehlgeschlagen"}
    else:
        logger.info(
            "CRON_OPS_SECRET/CRON_SECRET nicht gesetzt - Datenqualitäts-Report-E-Mail wird übersprungen (nur Log-Ausgabe)."
        )

    return {**summary, "previous": previous, "email": email_result}


@flow(
    name="data-quality",
    description="Prüft alle aktiven ZVG-Listings auf Plausibilität und erzeugt einen Tagesreport.",
    log_prints=True,
)
async def data_quality_flow(batch_size: int = 500) -> dict:
    """Standalone-Flow für manuelle Ausführung oder separates Scheduling."""
    check_result = await run_quality_checks_task(batch_size=batch_size)
    report_result = await generate_data_quality_report_task()
    return {"checks": check_result, "report": report_result}


if __name__ == "__main__":
    import asyncio

    asyncio.run(
        data_quality_flow.serve(
            name="data-quality-deployment",
            cron="30 8 * * *",  # täglich 08:30 Uhr, nach der 07:00-Uhr-daily-pipeline
        )
    )
