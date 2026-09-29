#!/usr/bin/env python3
"""
Backfill: Grunddaten (wohnflaeche_m2, baujahr etc.) aus KI-Analyse → zvg_listings

Hintergrund:
  Die KI extrahiert Grunddaten aus Gutachten-PDFs, speichert sie aber bisher
  nur im analyse_dict und nicht als eigene Spalten in zvg_ki_analyses.
  Dieses Script re-analysiert alle Listings mit fehlenden Grunddaten.

Vorgehen:
  1. Ermittelt alle Listings, bei denen wohnflaeche_m2 UND beschreibung NULL sind
     und die eine KI-Analyse haben (also bereits ein Gutachten/Exposé vorhanden war).
  2. Re-analysiert diese Listings per KI (nutzt vorhandene gutachten_url / expose_url).
  3. Der neue update_listing_grunddaten()-Call in ki_analysis.py schreibt die
     extrahierten Felder zurück.

Ausführung:
  cd scrapers
  DATABASE_URL="postgresql://immopulse:CHANGE_ME@localhost:5434/immopulse" \\
  .venv/bin/python backfill_listing_grunddaten.py [--limit 50] [--dry-run]

(Werte aus der lokalen .env übernehmen, siehe .env.example)
"""

import asyncio
import argparse
import os
import sys

import asyncpg
from loguru import logger


async def count_listings_missing_grunddaten(conn: asyncpg.Connection) -> int:
    """Zählt Listings mit KI-Analyse aber fehlenden Grunddaten."""
    row = await conn.fetchrow(
        """
        SELECT COUNT(*) AS cnt
        FROM zvg_listings l
        JOIN zvg_ki_analyses k ON k.listing_id = l.id
        WHERE l.ist_aktiv = TRUE
          AND (l.wohnflaeche_m2 IS NULL OR l.beschreibung IS NULL)
        """
    )
    return row["cnt"]


async def get_listings_for_reanalysis(conn: asyncpg.Connection, limit: int) -> list[dict]:
    """
    Holt Listings mit vorhandener KI-Analyse aber fehlenden Grunddaten.
    Bevorzugt Listings mit gutachten_url oder expose_url.
    """
    rows = await conn.fetch(
        """
        SELECT l.id, l.aktenzeichen, l.beschreibung, l.lat, l.lng,
               l.gutachten_url, l.expose_url
        FROM zvg_listings l
        JOIN zvg_ki_analyses k ON k.listing_id = l.id
        WHERE l.ist_aktiv = TRUE
          AND (l.wohnflaeche_m2 IS NULL OR l.beschreibung IS NULL)
          AND (
            l.gutachten_url IS NOT NULL
            OR l.expose_url IS NOT NULL
            OR (l.beschreibung IS NOT NULL AND length(l.beschreibung) > 50)
          )
        ORDER BY
          CASE WHEN l.gutachten_url IS NOT NULL THEN 0
               WHEN l.expose_url IS NOT NULL THEN 1
               ELSE 2 END,
          l.updated_at DESC
        LIMIT $1
        """,
        limit,
    )
    return [dict(r) for r in rows]


async def get_before_stats(conn: asyncpg.Connection) -> dict:
    """Aktuelle Statistik vor dem Backfill."""
    row = await conn.fetchrow(
        """
        SELECT
            COUNT(*) FILTER (WHERE wohnflaeche_m2 IS NOT NULL) AS mit_wohnflaeche,
            COUNT(*) FILTER (WHERE beschreibung IS NOT NULL) AS mit_beschreibung,
            COUNT(*) FILTER (WHERE baujahr IS NOT NULL) AS mit_baujahr,
            COUNT(*) FILTER (WHERE zimmer IS NOT NULL) AS mit_zimmer,
            COUNT(*) AS gesamt
        FROM zvg_listings
        WHERE ist_aktiv = TRUE
        """
    )
    return dict(row)


async def main():
    parser = argparse.ArgumentParser(
        description="Backfill Grunddaten aus KI-Analyse → zvg_listings"
    )
    parser.add_argument(
        "--limit", type=int, default=50, help="Max. Listings pro Lauf (default: 50)"
    )
    parser.add_argument("--dry-run", action="store_true", help="Nur anzeigen, nicht analysieren")
    args = parser.parse_args()

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        logger.error("DATABASE_URL nicht gesetzt")
        sys.exit(1)

    # Scraper-Root in den Python-Path einhängen (analog zu backfill_photos.py)
    scraper_root = os.path.dirname(os.path.abspath(__file__))
    if scraper_root not in sys.path:
        sys.path.insert(0, scraper_root)

    conn = await asyncpg.connect(database_url)
    try:
        before = await get_before_stats(conn)
        missing = await count_listings_missing_grunddaten(conn)
        listings = await get_listings_for_reanalysis(conn, args.limit)
    finally:
        await conn.close()

    logger.info("=" * 60)
    logger.info("BACKFILL: Grunddaten aus KI-Analyse → zvg_listings")
    logger.info("=" * 60)
    logger.info(f"Aktive Listings gesamt:       {before['gesamt']}")
    logger.info(f"Davon mit wohnflaeche_m2:      {before['mit_wohnflaeche']}")
    logger.info(f"Davon mit beschreibung:        {before['mit_beschreibung']}")
    logger.info(f"Davon mit baujahr:             {before['mit_baujahr']}")
    logger.info(f"Davon mit zimmer:              {before['mit_zimmer']}")
    logger.info(f"Fehlende Grunddaten (ki-anal): {missing}")
    logger.info(f"Zu re-analysierende Listings:  {len(listings)}")
    logger.info("=" * 60)

    if args.dry_run:
        logger.info("DRY-RUN: Keine Änderungen vorgenommen.")
        for l in listings[:10]:
            logger.info(
                f"  - {l['aktenzeichen']} | gutachten={bool(l['gutachten_url'])} | expose={bool(l['expose_url'])}"
            )
        if len(listings) > 10:
            logger.info(f"  ... und {len(listings) - 10} weitere")
        return

    if not listings:
        logger.info("Keine Listings zu backfillen – alle Grunddaten bereits vorhanden.")
        return

    # analyze_listing aus ki_analysis importieren
    from src.flows.ki_analysis import analyze_listing

    success = 0
    failed = 0
    for i, listing in enumerate(listings, 1):
        logger.info(f"[{i}/{len(listings)}] Re-analysiere: {listing['aktenzeichen']}")
        try:
            ok = await analyze_listing(listing)
            if ok:
                success += 1
                logger.info("  ✓ Erfolgreich")
            else:
                failed += 1
                logger.warning("  ✗ Übersprungen (kein Text)")
        except Exception as e:
            failed += 1
            logger.error(f"  ✗ Fehler: {e}")
        await asyncio.sleep(2)

    # Nachher-Statistik
    conn = await asyncpg.connect(database_url)
    try:
        after = await get_before_stats(conn)
    finally:
        await conn.close()

    logger.info("=" * 60)
    logger.info("ERGEBNIS")
    logger.info("=" * 60)
    logger.info(f"Re-analysiert: {success}/{len(listings)} erfolgreich, {failed} fehlgeschlagen")
    logger.info(
        f"wohnflaeche_m2: {before['mit_wohnflaeche']} → {after['mit_wohnflaeche']} (+{after['mit_wohnflaeche'] - before['mit_wohnflaeche']})"
    )
    logger.info(
        f"beschreibung:   {before['mit_beschreibung']} → {after['mit_beschreibung']} (+{after['mit_beschreibung'] - before['mit_beschreibung']})"
    )
    logger.info(
        f"baujahr:        {before['mit_baujahr']} → {after['mit_baujahr']} (+{after['mit_baujahr'] - before['mit_baujahr']})"
    )
    logger.info(
        f"zimmer:         {before['mit_zimmer']} → {after['mit_zimmer']} (+{after['mit_zimmer'] - before['mit_zimmer']})"
    )
    logger.info("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
