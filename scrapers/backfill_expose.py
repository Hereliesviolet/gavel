#!/usr/bin/env python3
"""
Backfill-Script: expose_url für alle zvg.com-Listings über act=getPDF ermitteln.

Das act=getPDF-Endpunkt liefert:
  {
    "pdf":    "https://www.zvg.com/content/pdfaz/G...pdf",  ← Gutachten-PDF
    "expose": "https://www.zvg.com/bilder/.../Kurzbeschreibung_...pdf",  ← Expose (oder "")
    ...
  }

Strategie:
1. Alle aktiven Listings aus der DB holen (ohne expose_url ODER mit MinIO-localhost-URL)
2. Pro Listing: act=getPDF aufrufen und "expose"-Feld auslesen
3. DB-Update mit der originalen zvg.com-URL (kein MinIO-Upload)

Verwendung:
    cd scrapers
    .venv/bin/python backfill_expose.py [--limit 600] [--dry-run]
"""

import asyncio
import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import asyncpg
from loguru import logger

from src.utils.user_agent import user_agent
from src.utils.url_safety import (
    UrlSafetyError,
    ZVG_COM_HOSTS,
    assert_zvg_com_url,
    fetch_public_url,
)

BASE_URL = "https://zvg.com"

HEADERS = {
    "User-Agent": user_agent(),
    "Accept": "application/json, */*",
    "Referer": "https://zvg.com/",
}
DELAY = 0.4


def accepted_expose_url(raw: object, *, resolve_dns: bool = True) -> str | None:
    if not isinstance(raw, str) or not raw.strip():
        return None
    try:
        return assert_zvg_com_url(raw.strip(), resolve_dns=resolve_dns)
    except UrlSafetyError:
        return None


async def fetch_expose_url(zvg_id: int) -> str | None:
    """
    Holt die Expose-URL über act=getPDF.
    Gibt die originale zvg.com-URL zurück oder None falls kein Expose vorhanden.
    """
    try:
        r = await fetch_public_url(
            f"{BASE_URL}/v2024/termine.prg?act=getPDF&id={zvg_id}",
            timeout_sec=10.0,
            headers=HEADERS,
            require_https=True,
            allowed_hosts=ZVG_COM_HOSTS,
        )
        if r.status_code == 200:
            data = r.json()
            if not isinstance(data, dict):
                return None
            return accepted_expose_url(data.get("expose", ""))
    except Exception as e:
        logger.debug(f"getPDF für ID {zvg_id} fehlgeschlagen: {e}")
    return None


async def backfill(limit: int = 600, dry_run: bool = False) -> None:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        sys.exit(
            "FEHLER: DATABASE_URL muss als Umgebungsvariable gesetzt sein "
            "(Wert aus der lokalen .env, kein Secret hardcoden)."
        )
    conn = await asyncpg.connect(database_url)
    try:
        # Alle aktiven zvg.com-Listings holen:
        # - ohne expose_url, ODER
        # - mit einer MinIO-localhost-URL (falsch gespeichert)
        db_rows = await conn.fetch(
            """
            SELECT id, aktenzeichen, slug,
                   (raw_data->>'zvg_id')::int AS zvg_id
            FROM zvg_listings
            WHERE source = 'zvg.com'
              AND ist_aktiv = TRUE
              AND raw_data->>'zvg_id' IS NOT NULL
              AND (
                expose_url IS NULL
                OR expose_url LIKE 'http://localhost%'
              )
            ORDER BY created_at DESC
            LIMIT $1
            """,
            limit,
        )

        if not db_rows:
            logger.info("Keine Listings ohne (gültige) expose_url gefunden.")
            return

        logger.info(f"{len(db_rows)} Listings zu verarbeiten")

        found = 0
        not_found = 0

        for i, row in enumerate(db_rows):
            zvg_id = row["zvg_id"]
            if not zvg_id:
                continue

            logger.info(f"[{i + 1}/{len(db_rows)}] {row['aktenzeichen']} (zvg_id={zvg_id})")

            expose_url = await fetch_expose_url(zvg_id)

            if not expose_url:
                logger.debug("  → kein Expose verfügbar")
                not_found += 1
                await asyncio.sleep(DELAY)
                continue

            logger.success(f"  → {expose_url}")

            if dry_run:
                logger.info("  (dry-run, kein DB-Update)")
                found += 1
                await asyncio.sleep(DELAY)
                continue

            await conn.execute(
                "UPDATE zvg_listings SET expose_url=$1, updated_at=NOW() WHERE id=$2",
                expose_url,
                row["id"],
            )
            found += 1
            await asyncio.sleep(DELAY)

        logger.info(
            f"\nFertig: {found} Exposes gefunden/aktualisiert, "
            f"{not_found} ohne Expose" + (" (dry-run)" if dry_run else "")
        )

    finally:
        await conn.close()


def main():
    parser = argparse.ArgumentParser(description="Backfill expose_url für zvg.com-Listings")
    parser.add_argument("--limit", type=int, default=600)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    asyncio.run(backfill(limit=args.limit, dry_run=args.dry_run))


if __name__ == "__main__":
    main()
