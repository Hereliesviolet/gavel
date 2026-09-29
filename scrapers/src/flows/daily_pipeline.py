"""
Prefect Master-Flow: Tägliche Gavel-Pipeline

Führt folgende Schritte in Sequenz aus:
1. zvg_daily_flow()               — Justizportal (zvg-portal.de), alle 16 Bundesländer
2. zvg_com_daily_flow()           — zvg.com, Fotos/Gutachten/Exposes, Deaktivierung
3. hanmark_daily_flow()           — hanmark.de, Fotos, Deaktivierung
4. 5 Minuten Pause (DB-Writes abschließen lassen)
5. geocode_missing_listings_task()— Koordinaten (lat/lng) für neue + rückständige
                                     Listings ohne Koordinaten nachtragen (Nominatim,
                                     rate-limited 1 req/s, siehe geocoding.py)
6. ki_analysis_flow(KI_DAILY_LIMIT) — neue Listings per KI analysieren (inkl.
                                     Cross-Validation KI-Extraktion vs. Rohdaten);
                                     füllt das verbleibende Limit zusätzlich mit
                                     Re-Analysen bestehender, aber veralteter/
                                     unvollständiger Analysen (fehlender
                                     investment_score / Fix&Flip-Deal / veralteter
                                     Schema-Versions-Marker, siehe
                                     get_listings_needing_reanalysis)
7. run_quality_checks_task() +    — Plausibilitätsprüfung ALLER aktiven Objekte
   generate_data_quality_report_task()  + Tages-Report/Trend (siehe data_quality.py,
                                     docs/DATA_QUALITY.md)
8. archive_past_listings_task()   — konsolidierte Archivierung: abgelaufener
                                     Termin ODER seit MISSING_TOLERANCE_DAYS
                                     Tagen nicht mehr bei der Quelle gesehen
                                     (last_seen_at, siehe archive_past_listings.py)
9. check_alerts_task()            — User-Alerts gegen neue Listings abgleichen, E-Mails versenden

Geocoding-Fix (2026-07-04):
  Vor diesem Fix wurde in KEINEM Flow jemals lat/lng gesetzt - Koordinaten
  entstanden ausschließlich, wenn jemand manuell backfill_geocoding.py
  ausführte. Dadurch hatten 54% aller aktiven Listings (in Bayern 100%)
  keine Koordinaten und die Kartenansicht blieb leer. Schritt 5 stellt jetzt
  sicher, dass jedes neu gescrapte Listing automatisch geocodiert wird und
  der bestehende Backlog schrittweise (250 Listings/Tag) mit abgebaut wird.
  Siehe src/flows/geocoding.py für Details zum eigentlichen Bug.

Zeitplan: täglich 07:00 Uhr
"""

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any, Optional

from prefect import flow, get_run_logger

from src.flows.zvg_daily import zvg_daily_flow
from src.flows.zvg_com_daily import zvg_com_daily_flow
from src.flows.hanmark_daily import hanmark_daily_flow
from src.flows.geocoding import geocode_missing_listings_task
from src.flows.ki_analysis import ki_analysis_flow
from src.flows.archive_past_listings import archive_past_listings_task
from src.flows.check_alerts import check_alerts_task
from src.flows.data_quality import run_quality_checks_task, generate_data_quality_report_task
from src.storage.scrape_jobs import record_scrape_job_safe, step_succeeded_today
from src.utils.analysis_run_lock import hold_heavy_run_lock
from src.utils.ki_limits import ki_daily_limit

PAUSE_SECONDS = 300  # 5 Minuten
SKIPPED_TODAY = {"skipped": True, "reason": "already-done-today"}


async def run_recorded_step(
    logger,
    label: str,
    flow_name: str,
    runner: Callable[[], Awaitable[Any]],
    *,
    found_key: str,
    prefect_run_id: Optional[str],
    normalize: Optional[Callable[[Any], dict]] = None,
) -> dict:
    if await step_succeeded_today(flow_name):
        logger.info(f"{label} übersprungen: heute bereits erfolgreich")
        return dict(SKIPPED_TODAY)
    try:
        result = await runner()
        if not isinstance(result, dict):
            result = {"error": "ungueltiges Ergebnis"}
        elif normalize:
            result = normalize(result)
    except Exception as exc:
        logger.error(f"{label} fehlgeschlagen: {exc}")
        result = {"error": str(exc)}
    await record_scrape_job_safe(
        flow_name, result, found_key=found_key, prefect_run_id=prefect_run_id
    )
    return result


@flow(
    name="daily-pipeline",
    description=(
        "Tägliche Pipeline: Justizportal → zvg.com → hanmark.de "
        "→ 5 min Pause → Geocoding → KI-Analyse → Archivierung → Alerts"
    ),
    log_prints=True,
)
async def daily_pipeline_flow():
    """
    Master-Flow für die tägliche Gavel-Pipeline.
    Scrapt Justizportal, zvg.com und hanmark.de, wartet auf DB-Writes,
    geocodiert fehlende Koordinaten, führt dann KI-Analyse, Archivierung
    und Alert-Versand durch.
    """
    logger = get_run_logger()
    logger.info("=== Tägliche Gavel-Pipeline gestartet ===")
    prefect_run_id = None
    try:
        from prefect.runtime import flow_run

        prefect_run_id = str(getattr(flow_run, "id", "") or "") or None
    except Exception:
        prefect_run_id = None

    async with hold_heavy_run_lock():
        return await _run_daily_steps(logger, prefect_run_id)


async def _run_daily_steps(logger, prefect_run_id: Optional[str]) -> dict:
    logger.info("Schritt 1/9: Starte Justizportal-Scraping (zvg-portal.de)...")
    zvg_result = await run_recorded_step(
        logger,
        "Justizportal",
        "zvg_portal",
        zvg_daily_flow,
        found_key="total_stored",
        prefect_run_id=prefect_run_id,
    )
    if not zvg_result.get("skipped"):
        logger.info(
            f"Justizportal abgeschlossen: {zvg_result.get('total_stored', 0)} Listings, "
            f"{zvg_result.get('total_photos', 0)} Fotos"
        )

    logger.info("Schritt 2/9: Starte zvg.com-Scraping...")
    zvg_com_result = await run_recorded_step(
        logger,
        "zvg.com",
        "zvg_com",
        zvg_com_daily_flow,
        found_key="stored",
        prefect_run_id=prefect_run_id,
    )
    if not zvg_com_result.get("skipped"):
        logger.info(
            f"zvg.com abgeschlossen: {zvg_com_result.get('stored', 0)} Listings, "
            f"{zvg_com_result.get('exposes', 0)} Exposes, "
            f"{zvg_com_result.get('deactivated', 0)} explizit aufgehoben deaktiviert"
        )

    logger.info("Schritt 3/9: Starte hanmark.de-Scraping...")
    hanmark_result = await run_recorded_step(
        logger,
        "hanmark.de",
        "hanmark",
        hanmark_daily_flow,
        found_key="total_stored",
        prefect_run_id=prefect_run_id,
    )
    if not hanmark_result.get("skipped"):
        logger.info(
            f"hanmark.de abgeschlossen: {hanmark_result.get('total_stored', 0)} Listings, "
            f"{hanmark_result.get('total_photos', 0)} Fotos"
        )

    scraped = not (
        zvg_result.get("skipped")
        and zvg_com_result.get("skipped")
        and hanmark_result.get("skipped")
    )
    if scraped:
        logger.info(f"Schritt 4/9: Pause {PAUSE_SECONDS // 60} Minuten für DB-Writes...")
        await asyncio.sleep(PAUSE_SECONDS)
    else:
        logger.info("Schritt 4/9: Pause übersprungen (keine neuen Scrapes heute)")

    logger.info("Schritt 5/9: Starte Geocoding fehlender Koordinaten...")

    async def _geocode():
        result = await geocode_missing_listings_task(limit=250)
        result.setdefault("items_new", int(result.get("geocoded", 0) or 0))
        return result

    geocode_result = await run_recorded_step(
        logger,
        "Geocoding",
        "geocoding",
        _geocode,
        found_key="attempted",
        prefect_run_id=prefect_run_id,
    )
    if not geocode_result.get("skipped") and not geocode_result.get("error"):
        logger.info(
            f"Geocoding abgeschlossen: {geocode_result.get('geocoded', 0)} geocodiert, "
            f"{geocode_result.get('failed', 0)} fehlgeschlagen "
            f"(von {geocode_result.get('attempted', 0)} versucht)."
        )

    ki_limit = ki_daily_limit()
    logger.info(f"Schritt 6/9: Starte KI-Analyse (limit={ki_limit})...")

    async def _ki():
        result = await ki_analysis_flow(limit=ki_limit, occupy_worker=False)
        return result if isinstance(result, dict) else {"attempted": 0}

    ki_result = await run_recorded_step(
        logger,
        "KI-Analyse",
        "ki_analysis",
        _ki,
        found_key="attempted",
        prefect_run_id=prefect_run_id,
    )

    logger.info("Schritt 7/9: Datenqualitätsprüfung (alle aktiven Objekte) + Report...")

    async def _quality():
        quality_check_result = await run_quality_checks_task(batch_size=500)
        quality_report_result = await generate_data_quality_report_task()
        logger.info(
            f"Datenqualität abgeschlossen: {quality_check_result.get('checked', 0)} geprüft, "
            f"{quality_check_result.get('flagged', 0)} mit needs_review "
            f"({quality_report_result.get('total_needs_review', 0)}/{quality_report_result.get('total_active', 0)} aktiv gesamt)."
        )
        return {
            **quality_check_result,
            "items_new": int(quality_check_result.get("flagged", 0) or 0),
            "report": quality_report_result,
        }

    quality_job = await run_recorded_step(
        logger,
        "Datenqualität",
        "data_quality",
        _quality,
        found_key="checked",
        prefect_run_id=prefect_run_id,
    )
    quality_report_result = quality_job.get("report") or quality_job

    logger.info("Schritt 8/9: Archiviere abgelaufene/verschwundene Versteigerungen...")

    async def _archive():
        archive_result = await archive_past_listings_task()
        logger.info(
            f"Archivierung abgeschlossen: {archive_result.get('archived', 0)} archiviert "
            f"(nach Quelle: {archive_result.get('by_source', {})}, "
            f"nach Grund: {archive_result.get('by_reason', {})})"
        )
        return {
            **archive_result,
            "items_new": int(archive_result.get("archived", 0) or 0),
        }

    archive_result = await run_recorded_step(
        logger,
        "Archivierung",
        "archive",
        _archive,
        found_key="archived",
        prefect_run_id=prefect_run_id,
    )

    logger.info("Schritt 9/9: Prüfe User-Alerts und versende Benachrichtigungen...")

    async def _alerts():
        alerts_result = await check_alerts_task()
        return {
            **alerts_result,
            "items_new": int(alerts_result.get("emails", 0) or 0),
        }

    alerts_result = await run_recorded_step(
        logger,
        "Alert-Check",
        "alerts",
        _alerts,
        found_key="newMatches",
        prefect_run_id=prefect_run_id,
    )
    logger.info(f"Alert-Check abgeschlossen: {alerts_result.get('emails', 0)} E-Mail(s) versendet.")

    logger.info("=== Tägliche Gavel-Pipeline abgeschlossen ===")
    return {
        "zvg_portal": zvg_result,
        "zvg_com": zvg_com_result,
        "hanmark": hanmark_result,
        "geocoding": geocode_result,
        "ki_analysis": ki_result,
        "data_quality": quality_report_result,
        "archived": archive_result.get("archived", 0),
        "alerts": alerts_result,
    }


if __name__ == "__main__":
    asyncio.run(
        daily_pipeline_flow.serve(
            name="daily-pipeline-deployment",
            cron="0 7 * * *",  # täglich 07:00 Uhr
        )
    )
