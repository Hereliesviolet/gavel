"""
Prefect Flow: ZVG-Daten täglich um 04:00 Uhr
Scrapt alle 16 Bundesländer vom Justizportal.

Foto-Logik:
  zvg-portal.de liefert ausschließlich PDF-Dokumente – keine echten Objektfotos.
  zvg_portal.py sucht auf den Detailseiten nur nach echten Bilddateien
  (.jpg/.jpeg/.png). Im Regelfall bleibt image_urls leer; der Flow speichert
  dann keine zvg_images-Einträge. Der Platzhalter im Frontend ist deutlich
  besser als ein gerenderter Gerichtsdokument-Scan.

"Verschwunden"-Erkennung (seit 2026-07-04):
  Dieser Flow deaktiviert veraltete Listings NICHT mehr selbst sofort
  (früher: deactivate_stale_listings, Ein-Tages-Vergleich gegen die heute
  gescrapten Slugs). Stattdessen aktualisiert upsert_zvg_listing() für jedes
  heute gefundene Listing last_seen_at=NOW(); Listings, die mehrere Tage in
  Folge nicht mehr auftauchen, archiviert der konsolidierte Mechanismus in
  archive_past_listings.py (siehe dort) – toleranter gegenüber einzelnen
  Scraper-Ausfällen als die frühere sofortige Ein-Tages-Prüfung.

Dokument-Logik (seit 2026-07-03):
  zvg_portal.scrape_bundesland() lädt zusätzlich Gutachten-/amtliche-
  Bekanntmachung-PDFs herunter (Referer-geschützte showAnhang-Links, siehe
  Docstring in zvg_portal.py) und lädt sie nach MinIO hoch. upsert_zvg_listing()
  schreibt gutachten_url/expose_url/beschreibung direkt mit. Nach dem Upsert
  kopiert bind_and_persist_zvg_assets die MinIO-Objekte auf {listing_id}/…,
  damit ein Slug-Suffix nicht das Gutachten der anderen Akte überschreibt. Die
  anschließende KI-Analyse (ki_analysis_flow) holt sich automatisch alle
  aktiven Listings mit Gutachten/Exposé/Beschreibung ohne bestehende Analyse –
  keine Sonderbehandlung für die Quelle "justizportal" nötig.
"""

import asyncio

from prefect import flow, task, get_run_logger

from src.sources.zvg_portal import scrape_bundesland, BUNDESLAND_ABK
from src.storage.postgres import upsert_zvg_listing
from src.storage.zvg_assets import bind_and_persist_zvg_assets
from src.utils.speicherquote import SpeicherquoteUnterschritten, pruefe_speicherquote


@task(retries=3, retry_delay_seconds=60)
async def scrape_and_store_bundesland(bundesland: str) -> dict:
    logger = get_run_logger()
    logger.info(f"Starte Scraping: {bundesland}")

    listings = await scrape_bundesland(bundesland, fetch_images=True)
    stored = 0
    items_new = 0
    items_updated = 0
    failed = 0
    photos_stored = 0

    for listing in listings:
        upserted = await upsert_zvg_listing(listing)
        if not upserted:
            failed += 1
            continue

        listing_id, is_new = upserted
        stored += 1
        if is_new:
            items_new += 1
        else:
            items_updated += 1

        photos_stored += await bind_and_persist_zvg_assets(listing_id, listing)

    logger.info(
        f"{bundesland}: {stored} gespeichert, {failed} fehlgeschlagen, "
        f"{photos_stored} Foto-Einträge"
    )
    return {
        "bundesland": bundesland,
        "stored": stored,
        "items_new": items_new,
        "items_updated": items_updated,
        "failed": failed,
        "photos": photos_stored,
        "total": len(listings),
    }


@flow(
    name="zvg-daily",
    description="Täglicher ZVG-Scraper für alle 16 Bundesländer (justizportal)",
    log_prints=True,
)
async def zvg_daily_flow(bundeslaender: list[str] | None = None):
    """Scrapt ZVG-Listings für alle (oder ausgewählte) Bundesländer vom Justizportal."""
    logger = get_run_logger()
    target_bundeslaender = bundeslaender or list(BUNDESLAND_ABK.keys())

    logger.info(f"ZVG-Daily-Flow gestartet: {len(target_bundeslaender)} Bundesländer")

    results = []

    for bl in target_bundeslaender:
        try:
            result = await scrape_and_store_bundesland(bl)
        except Exception as exc:
            logger.error(f"{bl} fehlgeschlagen: {exc}")
            result = {
                "bundesland": bl,
                "stored": 0,
                "items_new": 0,
                "items_updated": 0,
                "failed": 1,
                "photos": 0,
                "total": 0,
                "error": str(exc),
            }
        results.append(result)

    total_stored = sum(r["stored"] for r in results)
    total_new = sum(r.get("items_new", 0) for r in results)
    total_updated = sum(r.get("items_updated", 0) for r in results)
    total_failed = sum(r["failed"] for r in results)
    total_photos = sum(r["photos"] for r in results)

    # Deaktivierung veralteter/verschwundener Listings läuft NICHT mehr hier
    # (siehe Modul-Docstring) – erfolgt zentral + tolerant über last_seen_at
    # im konsolidierten Archivierungsschritt (archive_past_listings.py).
    logger.info(
        f"Flow abgeschlossen: {total_stored} gespeichert, "
        f"{total_failed} fehlgeschlagen, {total_photos} Fotos"
    )
    payload = {
        "results": results,
        "total_stored": total_stored,
        "items_new": total_new,
        "items_updated": total_updated,
        "total_photos": total_photos,
        "failed": total_failed,
    }
    try:
        pruefe_speicherquote("justizportal", total_stored, total_failed)
    except SpeicherquoteUnterschritten as exc:
        payload["error"] = str(exc)
    return payload


if __name__ == "__main__":
    asyncio.run(
        zvg_daily_flow.serve(
            name="zvg-daily-deployment",
            cron="0 4 * * *",
        )
    )
