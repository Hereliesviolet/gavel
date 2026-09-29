#!/usr/bin/env python3
"""
Backfill-Script: Geocodiert alle ZVG-Listings ohne lat/lng.

Verwendung:
    cd scrapers
    .venv/bin/python backfill_geocoding.py [--limit 30] [--dry-run]

Rate-Limit: max. 1 Anfrage/Sekunde (Nominatim-ToS).
"""

import asyncio
import argparse
import os
import sys
from pathlib import Path

# Projektpfad zum sys.path hinzufügen
sys.path.insert(0, str(Path(__file__).parent))

import asyncpg
from loguru import logger
from src.utils.geocoding import (
    HAS_GEOCODEABLE_LOCATION_SQL,
    MISSING_OR_NULL_ISLAND_SQL,
    geocode_with_fallback,
    is_usable_geo_point,
)

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://immopulse:change-me@localhost:5432/immopulse",
)


async def backfill(limit: int = 30, dry_run: bool = False) -> None:
    """Geocodiert Listings ohne Koordinaten."""

    # asyncpg erwartet postgresql:// statt postgresql+asyncpg://
    db_url = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")

    conn = await asyncpg.connect(db_url)

    try:
        rows = await conn.fetch(
            f"""
            SELECT id, adresse, plz, ort
            FROM zvg_listings
            WHERE {MISSING_OR_NULL_ISLAND_SQL}
              AND {HAS_GEOCODEABLE_LOCATION_SQL}
            ORDER BY created_at DESC
            LIMIT $1
            """,
            limit,
        )

        if not rows:
            logger.info("Keine Listings ohne Koordinaten gefunden.")
            return

        logger.info(f"Gefunden: {len(rows)} Listings ohne lat/lng (Limit: {limit})")

        success = 0
        failed = 0

        for i, row in enumerate(rows):
            listing_id = row["id"]
            adresse = row["adresse"]
            plz = row["plz"]
            ort = row["ort"]

            logger.info(f"[{i + 1}/{len(rows)}] Geocodiere: {adresse}, {plz} {ort or ''}".strip())

            coords = await geocode_with_fallback(adresse=adresse, plz=plz, ort=ort, delay=1.1)

            if coords and is_usable_geo_point(coords[0], coords[1]):
                lat, lng = coords
                logger.success(f"  → ({lat:.6f}, {lng:.6f})")

                if not dry_run:
                    await conn.execute(
                        """
                        UPDATE zvg_listings
                        SET lat = $1, lng = $2, updated_at = NOW()
                        WHERE id = $3
                        """,
                        lat,
                        lng,
                        listing_id,
                    )
                else:
                    logger.info("  (dry-run: kein DB-Update)")

                success += 1
            else:
                logger.warning("  → Kein Ergebnis (auch Fallback fehlgeschlagen)")
                failed += 1

            # Rate-Limit: 1 req/s (außer nach dem letzten Element)
            if i < len(rows) - 1:
                await asyncio.sleep(1.1)

        logger.info(
            f"\nFertig: {success} geocodiert, {failed} fehlgeschlagen"
            + (" (dry-run)" if dry_run else "")
        )

    finally:
        await conn.close()


def main():
    parser = argparse.ArgumentParser(
        description="Geocodiert ZVG-Listings ohne Koordinaten via Nominatim."
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=30,
        help="Maximale Anzahl zu geocodierender Listings (default: 30)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Koordinaten berechnen aber nicht in DB schreiben",
    )
    args = parser.parse_args()

    asyncio.run(backfill(limit=args.limit, dry_run=args.dry_run))


if __name__ == "__main__":
    main()
