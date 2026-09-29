"""
Prefect Task: Alert-Check & E-Mail-Versand auslösen

Ruft die interne Next.js-API-Route POST-geschützt (Bearer CRON_SECRET) auf,
die das eigentliche Alert-Matching (Kriterien vs. zvg_listings) und den
E-Mail-Versand übernimmt (app/api/cron/check-alerts/route.ts,
apps/web/lib/email.ts via SMTP/nodemailer).

Architekturentscheidung (siehe Aufgabenstellung, Punkt "Kernlogik"):
Bewusst Variante (b) - interne API-Route statt eigenständigem smtplib-Versand
in Python. Matching-Logik, E-Mail-Template (dunkles Branding) und die
Dedup-Tabelle `alert_notifications` existieren bereits vollständig in
Next.js/TypeScript; ein zweiter, unabhängiger Python-Pfad mit eigener
SMTP-Konfiguration im Scraper-Container hätte Logik und Zugangsdaten
unnötig dupliziert und wäre eine zusätzliche Fehlerquelle (zwei Stellen,
an denen Kriterien ausgewertet werden). Der Aufruf ist durch CRON_SECRET
abgesichert (Bearer-Token, siehe .env) und läuft ausschließlich intern über
das Docker-Netzwerk (http://web:3000), nicht über die öffentliche Domain.

Läuft am Ende der daily_pipeline als Schritt 7 (nach der Archivierung).
"""

import os

import httpx
from prefect import flow, task, get_run_logger

from src.utils.cron_secret import cron_secret_for_audience

INTERNAL_API_URL = os.environ.get("INTERNAL_API_URL", "http://web:3000")


@task(name="check-alerts", retries=2, retry_delay_seconds=30, timeout_seconds=120)
async def check_alerts_task() -> dict:
    """Löst das Alert-Matching + E-Mail-Versand über die interne API aus."""
    logger = get_run_logger()

    cron_secret = cron_secret_for_audience("CRON_EMAIL_SECRET")
    if not cron_secret:
        logger.error(
            "CRON_EMAIL_SECRET/CRON_SECRET ist nicht gesetzt - Alert-Check wird übersprungen."
        )
        return {
            "skipped": True,
            "error": "CRON_SECRET fehlt",
            "reason": "CRON_SECRET fehlt",
        }

    url = f"{INTERNAL_API_URL}/api/cron/check-alerts"
    logger.info(f"Rufe Alert-Check auf: {url}")

    async with httpx.AsyncClient(timeout=90) as client:
        response = await client.post(url, headers={"Authorization": f"Bearer {cron_secret}"})

    if response.status_code != 200:
        logger.error(
            f"Alert-Check fehlgeschlagen (HTTP {response.status_code}): {response.text[:500]}"
        )
        response.raise_for_status()

    result = response.json()
    logger.info(
        f"Alert-Check abgeschlossen: {result.get('processed', 0)} Alerts geprüft, "
        f"{result.get('newMatches', 0)} neue Treffer, {result.get('emails', 0)} E-Mail(s) versendet"
        f", {result.get('skippedMissingGeocode', 0)} ohne Koordinaten."
    )
    if result.get("errors"):
        for err in result["errors"]:
            logger.warning(f"  Fehler: {err}")

    return result


@flow(
    name="check-alerts",
    description="Gleicht aktive User-Alerts gegen zvg_listings ab und löst E-Mail-Versand aus.",
    log_prints=True,
)
async def check_alerts_flow() -> dict:
    """Standalone-Flow für manuelle Ausführung oder separates Scheduling (stündlich)."""
    result = await check_alerts_task()
    return result


if __name__ == "__main__":
    import asyncio

    asyncio.run(check_alerts_flow())
