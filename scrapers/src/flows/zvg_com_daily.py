"""
Prefect Flow: zvg.com-Daten täglich
Scrapt alle Bundesländer von zvg.com, lädt Fotos, Gutachten und Exposes hoch.
Deaktiviert explizit aufgehobene Termine sofort (terminAufgehoben==1 – ein
definitives Signal der Quelle selbst).

"Verschwunden"-Erkennung (seit 2026-07-04):
  Der frühere Orphan-Check (in DB aktive zvg_ids, die heute nicht mehr
  gescrapt wurden → sofort deaktiviert) wurde entfernt. Stattdessen
  aktualisiert upsert_zvg_listing() für jedes heute gefundene Listing
  last_seen_at=NOW(); Listings, die mehrere Tage in Folge nicht mehr
  auftauchen (ohne explizites terminAufgehoben-Flag – z.B. weil sie einfach
  nicht mehr in den API-Ergebnissen erscheinen), archiviert der konsolidierte
  Mechanismus in archive_past_listings.py (siehe dort) – toleranter gegenüber
  einzelnen Scraper-/API-Ausfällen als die frühere sofortige
  Ein-Tages-Prüfung.
"""

import asyncio

from prefect import flow, task, get_run_logger

from src.sources.zvg_com import scrape_all
from src.storage.minio import (
    upload_image,
    upload_gutachten,
    upload_expose,
    download_gutachten_pdf,
)
from src.storage.postgres import (
    upsert_zvg_listing,
    update_gutachten_url,
    update_expose_url,
    deactivate_zvg_listings,
    mark_scrape_completed,
    persist_zvg_gallery,
)
from src.utils.speicherquote import pruefe_speicherquote


@task(retries=2, retry_delay_seconds=60)
async def scrape_and_store_zvg_com() -> dict:
    logger = get_run_logger()
    logger.info("Starte zvg.com Scraping...")

    listings, scraped_aufgehoben_ids = await scrape_all(fetch_additional_images=True)
    stored = 0
    items_new = 0
    items_updated = 0
    failed = 0
    photos_uploaded = 0
    gutachten_uploaded = 0
    expose_uploaded = 0

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

        intended = listing.image_urls[:10]
        hochgeladen: list[tuple[str, str, int]] = []
        for i, img_url in enumerate(intended):
            result = await upload_image(
                img_url,
                listing.bundesland,
                listing.slug,
                listing_id=listing_id,
                position=i,
            )
            if result:
                storage_path, public_url = result
                hochgeladen.append((storage_path, public_url, i))
        photos_uploaded += await persist_zvg_gallery(listing_id, hochgeladen, len(intended))

        # Gutachten hochladen
        if listing.gutachten_url:
            pdf_bytes = await download_gutachten_pdf(listing.gutachten_url)
            if pdf_bytes:
                minio_url = await upload_gutachten(listing_id, pdf_bytes, listing.slug)
                if minio_url:
                    await update_gutachten_url(listing_id, minio_url)
                    gutachten_uploaded += 1

        # Expose hochladen
        if listing.expose_url:
            expose_bytes = await download_gutachten_pdf(listing.expose_url)
            if expose_bytes:
                minio_expose_url = await upload_expose(listing_id, expose_bytes, listing.slug)
                if minio_expose_url:
                    await update_expose_url(listing_id, minio_expose_url)
                    expose_uploaded += 1

        # Vollständigkeits-Gate (0006): erst HIER, nach den obigen Bild-/
        # Dokument-Download-Versuchen, gilt die Detail-Anreicherung dieses
        # Listings als abgeschlossen (siehe Docstring von mark_scrape_completed).
        await mark_scrape_completed(listing_id)

    logger.info(
        f"zvg.com: {stored} gespeichert, {failed} fehlgeschlagen, "
        f"{photos_uploaded} Fotos, {gutachten_uploaded} Gutachten, {expose_uploaded} Exposes"
    )
    return {
        "stored": stored,
        "items_new": items_new,
        "items_updated": items_updated,
        "failed": failed,
        "photos": photos_uploaded,
        "gutachten": gutachten_uploaded,
        "exposes": expose_uploaded,
        "total": len(listings),
        "scraped_aufgehoben_ids": set(scraped_aufgehoben_ids),
    }


@task
async def deactivate_cancelled_listings(scraped_aufgehoben_ids: set[int]) -> int:
    """
    Deaktiviert explizit von zvg.com als "aufgehoben" markierte Termine
    (terminAufgehoben==1) sofort – ein definitives Signal der Quelle selbst,
    im Gegensatz zum bloßen Nicht-mehr-Auftauchen in den Scrape-Ergebnissen
    (dafür siehe last_seen_at + archive_past_listings.py, Modul-Docstring).

    Gibt Anzahl deaktivierter Listings zurück.
    """
    logger = get_run_logger()
    logger.info(f"Deaktivierung: {len(scraped_aufgehoben_ids)} explizit aufgehoben")

    if not scraped_aufgehoben_ids:
        logger.info("Keine aufgehobenen Listings zu deaktivieren")
        return 0

    count = await deactivate_zvg_listings(list(scraped_aufgehoben_ids))
    logger.info(f"Deaktiviert: {count} aufgehobene Listings")
    return count


@flow(
    name="zvg-com-daily",
    description="Täglicher zvg.com-Scraper: Listings, Fotos, Gutachten, Exposes + Deaktivierung",
    log_prints=True,
)
async def zvg_com_daily_flow():
    logger = get_run_logger()
    logger.info("zvg-com-daily-Flow gestartet")

    # 1. Scrapen & Speichern
    result = await scrape_and_store_zvg_com()

    # 2. Explizit aufgehobene Termine sofort deaktivieren (verwaiste/
    # "einfach nicht mehr aufgetauchte" Listings laufen über last_seen_at +
    # den konsolidierten Archivierungsschritt, siehe Modul-Docstring)
    deactivated = await deactivate_cancelled_listings(
        scraped_aufgehoben_ids=result["scraped_aufgehoben_ids"],
    )

    logger.info(
        f"Flow abgeschlossen: {result['stored']} Listings, "
        f"{result['photos']} Fotos, {result['gutachten']} Gutachten, "
        f"{result['exposes']} Exposes, {deactivated} deaktiviert"
    )
    pruefe_speicherquote("zvg.com", result["stored"], result["failed"])

    return {**result, "deactivated": deactivated}


if __name__ == "__main__":
    asyncio.run(
        zvg_com_daily_flow.serve(
            name="zvg-com-daily-deployment",
            cron="0 5 * * *",
        )
    )
