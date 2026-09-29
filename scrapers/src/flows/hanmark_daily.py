"""
Prefect Flow: hanmark.de-Daten täglich
Scrapt alle Bundesländer von hanmark.de, lädt Fotos hoch, speichert in DB.

"Verschwunden"-Erkennung (seit 2026-07-04):
  Dieser Flow deaktiviert veraltete Listings NICHT mehr selbst sofort
  (früher: deactivate_stale_listings, Ein-Tages-Vergleich gegen die heute
  gescrapten Slugs). Stattdessen aktualisiert upsert_zvg_listing() für jedes
  heute gefundene Listing last_seen_at=NOW(); Listings, die mehrere Tage in
  Folge nicht mehr auftauchen, archiviert der konsolidierte Mechanismus in
  archive_past_listings.py (siehe dort) – toleranter gegenüber einzelnen
  Scraper-Ausfällen als die frühere sofortige Ein-Tages-Prüfung.

Foto-Logik:
  hanmark.de liefert echte Objektfotos als JPEG.
  Vollbilder (abbildung-{ID}.jpg, titelbild-hauptansicht-{ID}.jpg) werden
  heruntergeladen und in MinIO gespeichert.
"""

import asyncio

from prefect import flow, task, get_run_logger

from src.sources.hanmark import scrape_bundesland, BUNDESLAND_SLUG_MAP
from src.storage.postgres import deactivate_hanmark_listing, upsert_zvg_listing
from src.storage.zvg_assets import bind_and_persist_zvg_assets
from src.utils.speicherquote import SpeicherquoteUnterschritten, pruefe_speicherquote


@task(retries=2, retry_delay_seconds=60)
async def scrape_and_store_hanmark_bundesland(bundesland: str) -> dict:
    logger = get_run_logger()
    logger.info(f"hanmark: Starte Scraping {bundesland}")

    listings = await scrape_bundesland(bundesland, fetch_images=True)
    stored = 0
    items_new = 0
    items_updated = 0
    failed = 0
    photos_stored = 0
    deactivated = 0

    for listing in listings:
        # "Termin aufgehoben"-Listings
        # NICHT normal upserten (das würde last_seen_at hochziehen und
        # ist_aktiv wieder auf TRUE setzen, siehe upsert_zvg_listing) -
        # stattdessen gezielt deaktivieren, falls die Zeile existiert.
        if listing.termin_aufgehoben:
            if await deactivate_hanmark_listing(
                listing.aktenzeichen,
                listing.bundesland,
                listing.amtsgericht,
            ):
                deactivated += 1
            continue

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
        f"hanmark {bundesland}: {stored} gespeichert, {failed} fehlgeschlagen, "
        f"{photos_stored} Fotos, {deactivated} aufgehoben-deaktiviert"
    )
    return {
        "bundesland": bundesland,
        "stored": stored,
        "items_new": items_new,
        "items_updated": items_updated,
        "failed": failed,
        "photos": photos_stored,
        "deactivated": deactivated,
        "total": len(listings),
    }


@flow(
    name="hanmark-daily",
    description="Täglicher hanmark.de-Scraper: Listings + Fotos für alle Bundesländer",
    log_prints=True,
)
async def hanmark_daily_flow(bundeslaender: list[str] | None = None):
    """Scrapt hanmark.de für alle (oder ausgewählte) Bundesländer."""
    logger = get_run_logger()
    target = bundeslaender or list(BUNDESLAND_SLUG_MAP.values())
    logger.info(f"hanmark-daily-Flow gestartet: {len(target)} Bundesländer")

    results = []

    for bl in target:
        try:
            result = await scrape_and_store_hanmark_bundesland(bl)
        except Exception as exc:
            logger.error(f"hanmark {bl} fehlgeschlagen: {exc}")
            result = {
                "bundesland": bl,
                "stored": 0,
                "items_new": 0,
                "items_updated": 0,
                "failed": 1,
                "photos": 0,
                "deactivated": 0,
                "total": 0,
                "error": str(exc),
            }
        results.append(result)

    total_stored = sum(r["stored"] for r in results)
    total_new = sum(r.get("items_new", 0) for r in results)
    total_updated = sum(r.get("items_updated", 0) for r in results)
    total_failed = sum(r["failed"] for r in results)
    total_photos = sum(r["photos"] for r in results)
    total_deactivated = sum(r["deactivated"] for r in results)

    # Deaktivierung veralteter/verschwundener (aber nicht explizit als
    # "aufgehoben" markierter) Listings läuft NICHT mehr hier (siehe
    # Modul-Docstring) – erfolgt zentral + tolerant über last_seen_at im
    # konsolidierten Archivierungsschritt (archive_past_listings.py).
    # Explizit "Termin aufgehoben"-Listings (Fix 4) werden dagegen bereits
    # oben in scrape_and_store_hanmark_bundesland() sofort deaktiviert.
    logger.info(
        f"hanmark-daily: {total_stored} gespeichert, "
        f"{total_failed} fehlgeschlagen, {total_photos} Fotos, "
        f"{total_deactivated} aufgehoben-deaktiviert"
    )
    payload = {
        "results": results,
        "total_stored": total_stored,
        "items_new": total_new,
        "items_updated": total_updated,
        "total_photos": total_photos,
        "total_deactivated": total_deactivated,
        "failed": total_failed,
    }
    try:
        pruefe_speicherquote("hanmark.de", total_stored, total_failed)
    except SpeicherquoteUnterschritten as exc:
        payload["error"] = str(exc)
    return payload


if __name__ == "__main__":
    asyncio.run(
        hanmark_daily_flow.serve(
            name="hanmark-daily-deployment",
            cron="0 6 * * *",
        )
    )
