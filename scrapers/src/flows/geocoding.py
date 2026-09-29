"""
Prefect Task: Geocodierung fehlender Koordinaten (lat/lng) für zvg_listings

Hintergrund (Root-Cause, 2026-07-04):
Der eigentliche Geocoding-Code (src/utils/geocoding.py, Nominatim/OSM) war
technisch funktionsfähig, aber NIRGENDS in den täglichen Scraper-Flows
(zvg_daily.py, zvg_com_daily.py, hanmark_daily.py, daily_pipeline.py)
eingebunden - keiner dieser Flows setzt listing.lat/listing.lng, und
upsert_zvg_listing() schreibt dementsprechend für jedes neu gescrapte
Listing lat=NULL/lng=NULL. Die einzige Geocoding-Implementierung war
backfill_geocoding.py, ein rein manuelles Standalone-Skript ohne
Scheduling - Koordinaten entstanden also ausschließlich, wenn jemand dieses
Skript von Hand anstieß, nie automatisch. Zusätzlich enthielt
geocode_address() einen Bug, der die primäre (präzise) Anfrage fast immer
scheitern ließ (siehe Kommentar dort) - nur der Fallback lieferte
gelegentlich Treffer. In Summe hatten dadurch 365 von 681 aktiven Listings
(54%), in Bayern sogar 52 von 52 (100%), keine Koordinaten.

Dieser Task schließt die Lücke dauerhaft:
  - Läuft als Schritt der täglichen daily-pipeline (siehe daily_pipeline.py)
    NACH allen drei Scrapern, sodass jedes neu gescrapte Listing zeitnah
    automatisch geocodiert wird.
  - Verarbeitet zusätzlich pro Lauf ein Batch (limit) älterer Listings ohne
    Koordinaten, um den bestehenden Backlog schrittweise mit abzubauen
    (unabhängig vom einmaligen manuellen Backfill, siehe backfill_geocoding.py).
  - Rate-Limit: exakt 1 sequentielle Anfrage alle 1.1s (Nominatim-ToS: max.
    1 req/s) - KEINE parallelen Anfragen.
  - Einzelne fehlgeschlagene Adressen/DB-Fehler werden pro Listing abgefangen
    und geloggt, brechen aber nicht den gesamten Task/die gesamte Pipeline ab
    (vorher: mögliche stille Fehler ohne jede Sichtbarkeit).
"""

import asyncio
import os

import asyncpg
from prefect import flow, task, get_run_logger

from src.utils.geocoding import (
    HAS_GEOCODEABLE_LOCATION_SQL,
    MISSING_OR_NULL_ISLAND_SQL,
    geocode_with_fallback,
    is_usable_geo_point,
)

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://immopulse:change-me@localhost:5432/immopulse"
)
NOMINATIM_DELAY = 1.1  # Sekunden zwischen Anfragen, siehe Nominatim-ToS (max. 1 req/s)


@task(name="geocode-missing-listings", retries=1, retry_delay_seconds=60, timeout_seconds=1800)
async def geocode_missing_listings_task(limit: int = 250) -> dict:
    """
    Geocodiert aktive Listings ohne nutzbare Koordinaten
    (NULL oder Null-Island 0/0), batch-weise.

    Args:
        limit: Maximale Anzahl Listings pro Lauf (Schutz gegen zu lange
               Laufzeit/zu viele externe Anfragen an einem Tag - der Rest
               wird beim nächsten täglichen Lauf weiterverarbeitet).
    """
    logger = get_run_logger()
    db_url = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")

    conn = await asyncpg.connect(db_url)
    geocoded = 0
    failed = 0

    try:
        rows = await conn.fetch(
            f"""
            SELECT id, adresse, plz, ort
            FROM zvg_listings
            WHERE ist_aktiv = TRUE
              AND {MISSING_OR_NULL_ISLAND_SQL}
              AND {HAS_GEOCODEABLE_LOCATION_SQL}
            ORDER BY created_at DESC
            LIMIT $1
            """,
            limit,
        )

        if not rows:
            logger.info("Geocoding: Keine Listings mit Ort und ohne Koordinaten gefunden.")
            return {"attempted": 0, "geocoded": 0, "failed": 0}

        logger.info(
            f"Geocoding: {len(rows)} Listing(s) ohne Koordinaten gefunden (Limit: {limit})."
        )

        for i, row in enumerate(rows):
            if i > 0:
                # Rate-Limit zwischen Listings (geocode_with_fallback pausiert
                # zusätzlich selbst zwischen seinen eigenen Fallback-Versuchen).
                await asyncio.sleep(NOMINATIM_DELAY)

            listing_id = row["id"]
            try:
                coords = await geocode_with_fallback(
                    adresse=row["adresse"],
                    plz=row["plz"],
                    ort=row["ort"],
                    delay=NOMINATIM_DELAY,
                )

                if coords is None or not is_usable_geo_point(coords[0], coords[1]):
                    failed += 1
                    continue

                lat, lng = coords
                await conn.execute(
                    "UPDATE zvg_listings SET lat = $1, lng = $2, updated_at = NOW() WHERE id = $3",
                    lat,
                    lng,
                    listing_id,
                )
                geocoded += 1

            except Exception as exc:
                # Fehler bei einem einzelnen Listing darf den gesamten
                # Geocoding-Task (und damit die Pipeline) nicht abbrechen -
                # geloggt statt (wie zuvor an anderer Stelle) still verschluckt.
                logger.warning(f"Geocoding-Fehler für Listing {listing_id}: {exc}")
                failed += 1

        logger.info(
            f"Geocoding abgeschlossen: {geocoded} geocodiert, {failed} fehlgeschlagen "
            f"(von {len(rows)} versucht)."
        )
        return {"attempted": len(rows), "geocoded": geocoded, "failed": failed}

    finally:
        await conn.close()


@flow(
    name="geocode-missing-listings",
    description="Geocodiert aktive ZVG-Listings ohne Koordinaten via Nominatim (rate-limited).",
    log_prints=True,
)
async def geocode_missing_listings_flow(limit: int = 250) -> dict:
    """Standalone-Flow für manuelle Ausführung oder separates Scheduling."""
    return await geocode_missing_listings_task(limit=limit)


if __name__ == "__main__":
    import asyncio

    asyncio.run(geocode_missing_listings_flow())
