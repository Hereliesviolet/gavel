"""
Prefect Task: Konsolidierte Archivierung (2026-07-04)

Setzt täglich alle aktiven Listings auf ist_aktiv=False, die EINES der
folgenden zwei Kriterien erfüllen:

  1. termin_date liegt in der Vergangenheit (ursprüngliches Kriterium).
  2. "Verschwunden"-Erkennung: last_seen_at wurde seit MISSING_TOLERANCE_DAYS
     Tagen nicht mehr aktualisiert – d.h. das Objekt ist seitdem an mehreren
     aufeinanderfolgenden täglichen Scrape-Läufen der eigenen Quelle
     (justizportal, zvg.com, hanmark.de) nicht mehr in deren Ergebnissen
     aufgetaucht (upsert_zvg_listing aktualisiert last_seen_at bei jedem
     Treffer, siehe scrapers/src/storage/postgres.py). Vermutlicher Grund:
     Versteigerungstermin wurde von der Quelle abgesagt/verschoben/aufgehoben,
     ohne dass termin_date dabei in die Vergangenheit gerutscht wäre.

Ein Toleranzfenster von mehreren Tagen (statt einer sofortigen
Ein-Tages-Prüfung direkt im jeweiligen Quell-Flow) ist bewusst gewählt, um
einmalige Scraper-Hänger/Netzwerkfehler nicht sofort als "Objekt verschwunden"
fehlzuinterpretieren. Dies ist damit der EINE konsistente
Archivierungs-Mechanismus für alle drei Quellen (ersetzt die früheren,
separaten Sofort-Deaktivierungen pro Quelle) – läuft täglich als Schritt 6 der
daily_pipeline sowie stündlich als Sicherheitsnetz über archive_expired.sh.
"""

import os

from prefect import flow, task, get_run_logger

from src.storage.postgres import (
    ArchiveMissingShareBlocked,
    archive_expired_and_missing_listings,
)
from src.utils.ops_alert import post_ops_alert

# Wie viele Tage in Folge ein Objekt in den Scrape-Ergebnissen seiner Quelle
# nicht mehr auftauchen darf, bevor es automatisch archiviert wird. 2-3 Tage
# sind ein guter Kompromiss: toleriert einzelne Scraper-Ausfälle, erkennt
# aber tatsächlich verschwundene Objekte trotzdem zeitnah. Über die
# Umgebungsvariable MISSING_TOLERANCE_DAYS konfigurierbar (siehe .env).
MISSING_TOLERANCE_DAYS = int(os.environ.get("MISSING_TOLERANCE_DAYS", "3"))


@task(name="archive-past-listings", retries=2, retry_delay_seconds=30)
async def archive_past_listings_task() -> dict:
    """
    Führt die konsolidierte Archivierung aus (abgelaufener Termin ODER seit
    MISSING_TOLERANCE_DAYS nicht mehr bei der Quelle gesehen).
    Gibt Anzahl und Details der archivierten Listings zurück (aufgeschlüsselt
    nach Quelle und Archivierungsgrund).
    """
    logger = get_run_logger()
    logger.info(
        f"Starte konsolidierte Archivierung (Toleranz: {MISSING_TOLERANCE_DAYS} Tage "
        f"'nicht mehr gesehen')..."
    )

    try:
        rows = await archive_expired_and_missing_listings(MISSING_TOLERANCE_DAYS)
        blocked = None
    except ArchiveMissingShareBlocked as exc:
        rows = exc.expired
        blocked = exc
        await post_ops_alert(alertname="ArchiveMissingShare", summary=str(exc))

    count = len(rows)
    if count == 0 and blocked is None:
        logger.info("Keine abgelaufenen/verschwundenen Listings gefunden – nichts archiviert.")
        return {"archived": 0, "by_source": {}, "by_reason": {}}

    by_source: dict[str, int] = {}
    by_reason: dict[str, int] = {"termin_abgelaufen": 0, "quelle_verschwunden": 0}
    for r in rows:
        source = r.get("source") or "unbekannt"
        by_source[source] = by_source.get(source, 0) + 1
        grund = r.get("reason") or "quelle_verschwunden"
        by_reason[grund] = by_reason.get(grund, 0) + 1

    logger.info(
        f"{count} Listing(s) archiviert – nach Quelle: {by_source}, nach Grund: {by_reason}"
    )
    for r in rows[:15]:
        grund = (
            "Termin abgelaufen"
            if r.get("reason") == "termin_abgelaufen"
            else f"seit {r['last_seen_at']} nicht mehr bei Quelle gesehen"
        )
        logger.debug(f"  Archiviert: [{r['source']}] {r['aktenzeichen']} | {r['ort']} | {grund}")
    if count > 15:
        logger.debug(f"  ... und {count - 15} weitere.")

    result = {"archived": count, "by_source": by_source, "by_reason": by_reason}
    if blocked is not None:
        result["error"] = str(blocked)
        result["missing_share_blocked"] = True
    return result


@flow(
    name="archive-past-listings",
    description=(
        "Archiviert täglich alle Listings mit abgelaufenem Versteigerungstermin "
        "ODER seit mehreren Tagen nicht mehr bei ihrer Quelle gesehen."
    ),
    log_prints=True,
)
async def archive_past_listings_flow() -> dict:
    """Standalone-Flow für manuelle oder separate Ausführung."""
    result = await archive_past_listings_task()
    return result


if __name__ == "__main__":
    import asyncio

    asyncio.run(archive_past_listings_flow())
