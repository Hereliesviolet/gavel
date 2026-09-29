#!/usr/bin/env python3
"""
Backfill: Gutachten-/amtliche-Bekanntmachung-PDFs + Beschreibungstext für
bereits gescrapte justizportal.de-Listings nachladen.

Hintergrund (2026-07-03): scrapers/src/sources/zvg_portal.py lud bislang
KEINE PDF-Anhänge herunter (Feature existierte nur für zvg.com/hanmark.de).
Alle ~88 aktiven justizportal-Listings hatten daher gutachten_url=NULL,
expose_url=NULL und beschreibung=NULL, wodurch auch die KI-Analyse komplett
fehlte (kein analysierbarer Text). Der Scraper wurde um
_enrich_listing_from_detail() ergänzt (inkl. korrektem Referer-Header für die
Referer-geschützten showAnhang-Links von zvg-portal.de, siehe Docstring in
zvg_portal.py). Dieses Script wendet dieselbe Logik nachträglich auf bereits
in der DB vorhandene Listings an, die noch nicht angereichert wurden.

Ablauf:
  1. DB: Alle aktiven justizportal-Listings ohne Dokumente/Beschreibung holen
     (gutachten_url IS NULL AND expose_url IS NULL AND beschreibung IS NULL –
     dieses Tripel dient gleichzeitig als "bereits verarbeitet"-Marker, da
     nach einem Durchlauf i.d.R. mindestens die Beschreibung befüllt ist,
     auch wenn kein PDF-Anhang vorhanden war)
  2. Pro Bundesland gruppiert abarbeiten (Session-Wiederverwendung analog
     backfill_photos.py), Gutachten/Bekanntmachung herunterladen + in MinIO
     hochladen, Beschreibungstext extrahieren
  3. DB-Update (gutachten_url, expose_url, beschreibung)
  4. Kleine Pause zwischen Objekten (Rate-Limit-Schonung für zvg-portal.de)

Die eigentliche KI-Analyse übernimmt danach automatisch der stündliche
ki-analysis-Prefect-Flow (holt sich alle aktiven Listings mit Gutachten/
Expose/Beschreibung ohne KI-Analyse).

Verwendung (im Scraper-Container mit Zugriff auf Postgres + MinIO):
  docker exec gavel_scraper python backfill_zvg_portal_documents.py \\
    [--limit 50] [--dry-run] [--delay 2.0]
"""

import argparse
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

import asyncpg
import httpx
from loguru import logger

from src.sources.zvg_portal import (
    HEADERS as PORTAL_HEADERS,
    SEARCH_URL as PORTAL_SEARCH_URL,
    BUNDESLAND_ABK,
)
from src.sources.zvg_portal import _enrich_listing_from_detail
from src.utils.url_safety import ZVG_PORTAL_HOSTS, fetch_public_request

DEFAULT_DELAY = 2.0  # Sekunden zwischen Objekten (Rate-Limit-Schonung)


async def get_unenriched_listings(conn: asyncpg.Connection, limit: int) -> list[dict]:
    rows = await conn.fetch(
        """
        SELECT id::text, aktenzeichen, bundesland, slug, direktlink
        FROM zvg_listings
        WHERE source = 'justizportal'
          AND ist_aktiv = TRUE
          AND gutachten_url IS NULL
          AND expose_url IS NULL
          AND beschreibung IS NULL
          AND direktlink IS NOT NULL
        ORDER BY created_at DESC
        LIMIT $1
        """,
        limit,
    )
    return [dict(r) for r in rows]


async def update_listing(
    conn: asyncpg.Connection,
    listing_id: str,
    extra: dict,
) -> None:
    updates: list[str] = []
    values: list = []
    idx = 1
    for field in ("gutachten_url", "expose_url", "beschreibung"):
        if extra.get(field):
            updates.append(f"{field} = ${idx}")
            values.append(extra[field])
            idx += 1
    if not updates:
        return
    values.append(listing_id)
    sql = (
        f"UPDATE zvg_listings SET {', '.join(updates)}, updated_at = NOW() WHERE id = ${idx}::uuid"
    )
    await conn.execute(sql, *values)


async def backfill(limit: int, delay: float, dry_run: bool) -> None:
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    try:
        listings = await get_unenriched_listings(conn, limit)
        total = len(listings)
        logger.info(f"justizportal-Listings ohne Dokumente/Beschreibung: {total}")

        if not total:
            logger.info("Nichts zu tun – alle aktiven justizportal-Listings bereits angereichert.")
            return

        by_bundesland: dict[str, list[dict]] = {}
        for listing in listings:
            by_bundesland.setdefault(listing["bundesland"], []).append(listing)

        gutachten_found = 0
        bekanntmachung_found = 0
        beschreibung_found = 0
        processed = 0

        for bundesland, bl_listings in by_bundesland.items():
            abk = BUNDESLAND_ABK.get(bundesland)
            if not abk:
                logger.warning(
                    f"Unbekanntes Bundesland {bundesland!r}, überspringe {len(bl_listings)} Listings"
                )
                continue

            logger.info(f"=== {bundesland}: {len(bl_listings)} Listings ===")

            async with httpx.AsyncClient(
                headers=PORTAL_HEADERS, follow_redirects=False, timeout=30
            ) as client:

                async def refresh_session():
                    try:
                        await fetch_public_request(
                            "POST",
                            PORTAL_SEARCH_URL,
                            data={"ger_name": "", "land_abk": abk, "order_by": "2"},
                            timeout_sec=30.0,
                            headers=PORTAL_HEADERS,
                            allowed_hosts=ZVG_PORTAL_HOSTS,
                        )
                        await asyncio.sleep(1.5)
                    except Exception as e:
                        logger.warning(f"Session-Refresh fehlgeschlagen: {e}")

                await refresh_session()

                for idx, listing in enumerate(bl_listings):
                    if idx > 0 and idx % 8 == 0:
                        await refresh_session()

                    az = listing["aktenzeichen"]
                    direktlink = listing["direktlink"]
                    logger.info(f"[{processed + 1}/{total}] {az} ({bundesland})")

                    extra = await _enrich_listing_from_detail(
                        client, direktlink, bundesland, listing["slug"]
                    )

                    if extra.get("gutachten_url"):
                        gutachten_found += 1
                    if extra.get("expose_url"):
                        bekanntmachung_found += 1
                    if extra.get("beschreibung"):
                        beschreibung_found += 1

                    if extra:
                        logger.info(
                            f"  → Gutachten: {'ja' if extra.get('gutachten_url') else 'nein'}, "
                            f"Bekanntmachung: {'ja' if extra.get('expose_url') else 'nein'}, "
                            f"Beschreibung: {len(extra.get('beschreibung') or '')} Zeichen"
                        )
                        if not dry_run:
                            await update_listing(conn, listing["id"], extra)
                    else:
                        logger.debug("  → keine Anreicherung möglich (Detailseite nicht abrufbar?)")

                    processed += 1
                    await asyncio.sleep(delay)

        logger.info(
            f"\n=== Backfill abgeschlossen ({'DRY-RUN, ' if dry_run else ''}{processed}/{total} verarbeitet) ===\n"
            f"  Gutachten gefunden:        {gutachten_found}\n"
            f"  amtl. Bekanntmachung:      {bekanntmachung_found}\n"
            f"  Beschreibung extrahiert:   {beschreibung_found}"
        )

    finally:
        await conn.close()


def main():
    parser = argparse.ArgumentParser(
        description="Backfill Gutachten/amtl. Bekanntmachung/Beschreibung für justizportal-Listings"
    )
    parser.add_argument("--limit", type=int, default=50, help="Max. Anzahl Listings (default: 50)")
    parser.add_argument(
        "--delay", type=float, default=DEFAULT_DELAY, help="Sekunden Pause zwischen Objekten"
    )
    parser.add_argument("--dry-run", action="store_true", help="Nur anzeigen, keine DB-Updates")
    args = parser.parse_args()
    asyncio.run(backfill(limit=args.limit, delay=args.delay, dry_run=args.dry_run))


if __name__ == "__main__":
    main()
