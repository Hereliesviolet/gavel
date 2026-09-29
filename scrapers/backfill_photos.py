#!/usr/bin/env python3
"""
Backfill: Fotos für bestehende Listings ohne oder mit unvollständiger Galerie.

Ablauf:
  1. DB: Aktive zvg_listings mit weniger als 3 Fotos holen
  2. justizportal-Listings: Detailseite aufrufen, Anhänge laden, PDF→JPEG konvertieren
  3. zvg.com-Listings: Über getGalleryPics-API Bilder holen
  4. Alle Bilder in MinIO speichern, zvg_images-Tabelle befüllen

Ausführung:
  cd scrapers
  DATABASE_URL=postgresql://immopulse:CHANGE_ME@localhost:5434/immopulse \
  MINIO_ENDPOINT=localhost \
  MINIO_PORT=9000 \
  MINIO_ACCESS_KEY=gavel_minio \
  MINIO_SECRET_KEY=CHANGE_ME \
  MINIO_PUBLIC_URL=http://localhost:9000 \
  .venv/bin/python backfill_photos.py

(Werte aus der lokalen .env übernehmen, siehe .env.example)
"""

import asyncio
import os
import sys
import re

import asyncpg
import httpx
from loguru import logger

sys.path.insert(0, os.path.dirname(__file__))

# Env-Variablen setzen (falls nicht gesetzt) - echte Werte kommen aus .env,
# hier NUR unkritische Defaults, keine Secrets hardcoden!
os.environ.setdefault("MINIO_ENDPOINT", "localhost")
os.environ.setdefault("MINIO_PORT", "9000")
os.environ.setdefault("MINIO_ACCESS_KEY", "gavel_minio")
os.environ.setdefault("MINIO_PUBLIC_URL", "http://localhost:9000")

from src.utils.user_agent import user_agent
from src.storage.minio import upload_image, ensure_bucket
from src.sources.zvg_portal import (
    HEADERS as PORTAL_HEADERS,
    SEARCH_URL as PORTAL_SEARCH_URL,
    BUNDESLAND_ABK,
    _enrich_listing_from_detail,
)
from src.utils.url_safety import (
    ZVG_COM_HOSTS,
    ZVG_PORTAL_HOSTS,
    assert_image_fetch_url,
    fetch_public_request,
    fetch_public_url,
)
# Hinweis (2026-07-03): Dieses Script importierte zuvor die nie existierenden
# Namen `_collect_anhang_links`/`_download_anhang_as_image` aus zvg_portal.py
# (ImportError, Script war dadurch komplett unlauffähig – vermutlich Rest
# eines nie fertiggestellten früheren Anlaufs). Fix: Nutzung der tatsächlich
# vorhandenen `_enrich_listing_from_detail()`, die inzwischen zusätzlich
# Gutachten-/amtliche-Bekanntmachung-PDFs mit ausliefert (siehe deren dict).

ZVG_COM_HEADERS = {
    "User-Agent": user_agent(),
    "Accept": "application/json, */*",
    "Accept-Language": "de-DE,de;q=0.9",
    "Referer": "https://zvg.com/",
}
ZVG_COM_BASE = "https://zvg.com"
MINIO_PUBLIC_URL = os.environ.get("MINIO_PUBLIC_URL", "http://localhost:9000")
MINIO_BUCKET = "zvg-images"


# ────────────────────────────────────────────────
# DB-Hilfsfunktionen
# ────────────────────────────────────────────────


async def get_listings_without_photos(conn: asyncpg.Connection) -> list[dict]:
    rows = await conn.fetch(
        """
        SELECT l.id::text, l.aktenzeichen, l.source, l.direktlink, l.bundesland, l.slug
        FROM zvg_listings l
        LEFT JOIN (
          SELECT listing_id, count(*)::int AS n
          FROM zvg_images
          WHERE listing_id IS NOT NULL
          GROUP BY listing_id
        ) i ON i.listing_id = l.id
        WHERE l.ist_aktiv = TRUE
          AND COALESCE(i.n, 0) < 3
        ORDER BY COALESCE(i.n, 0) ASC, l.created_at DESC
        """
    )
    return [dict(r) for r in rows]


async def store_image(
    conn: asyncpg.Connection,
    listing_id: str,
    storage_path: str,
    public_url: str,
    position: int = 0,
) -> bool:
    try:
        await conn.execute(
            """
            INSERT INTO zvg_images (listing_id, storage_path, public_url, position, is_cover)
            VALUES ($1::uuid, $2, $3, $4, $5)
            ON CONFLICT DO NOTHING
            """,
            listing_id,
            storage_path,
            public_url,
            position,
            position == 0,
        )
        return True
    except Exception as e:
        logger.error(f"DB-Fehler beim Speichern: {e}")
        return False


# ────────────────────────────────────────────────
# justizportal.de Backfill
# ────────────────────────────────────────────────


async def backfill_justizportal(listings: list[dict], conn: asyncpg.Connection) -> int:
    """Füllt Fotos für justizportal-Listings nach."""
    stored = 0

    # Bundesländer gruppieren um Sessions optimal zu nutzen
    by_bundesland: dict[str, list[dict]] = {}
    for listing in listings:
        bl = listing["bundesland"]
        by_bundesland.setdefault(bl, []).append(listing)

    for bundesland, bl_listings in by_bundesland.items():
        abk = BUNDESLAND_ABK.get(bundesland)
        if not abk:
            logger.warning(f"Unbekanntes Bundesland {bundesland!r}, überspringe")
            continue

        logger.info(f"Backfill justizportal – {bundesland} ({len(bl_listings)} Listings)")

        SESSION_REFRESH_EVERY = 5  # Session alle N Anfragen erneuern

        async with httpx.AsyncClient(
            headers=PORTAL_HEADERS, follow_redirects=False, timeout=30
        ) as client:

            async def refresh_session():
                """Session durch erneuten POST erneuern."""
                try:
                    await fetch_public_request(
                        "POST",
                        PORTAL_SEARCH_URL,
                        data={"ger_name": "", "land_abk": abk, "order_by": "2"},
                        timeout_sec=30.0,
                        headers=PORTAL_HEADERS,
                        allowed_hosts=ZVG_PORTAL_HOSTS,
                    )
                    await asyncio.sleep(2.0)
                except Exception as e:
                    logger.warning(f"Session-Refresh fehlgeschlagen: {e}")

            await refresh_session()

            for idx, listing in enumerate(bl_listings):
                # Session nach jeweils N Listings auffrischen
                if idx > 0 and idx % SESSION_REFRESH_EVERY == 0:
                    logger.debug(f"Session-Refresh nach {idx} Listings")
                    await refresh_session()

                direktlink = listing.get("direktlink", "")
                if not direktlink:
                    logger.debug(f"Kein direktlink für {listing['aktenzeichen']}")
                    continue

                extra = await _enrich_listing_from_detail(
                    client,
                    direktlink,
                    bundesland,
                    listing["slug"],
                    max_images=3,
                )
                image_urls = extra.get("image_urls", [])

                # Retry bei Session-Fehler: einmalig Session erneuern und nochmal
                if not image_urls and direktlink:
                    logger.debug(f"Retry nach Session-Refresh für {listing['aktenzeichen']}")
                    await refresh_session()
                    extra = await _enrich_listing_from_detail(
                        client,
                        direktlink,
                        bundesland,
                        listing["slug"],
                        max_images=3,
                    )
                    image_urls = extra.get("image_urls", [])

                listing_stored = 0
                for i, public_url in enumerate(image_urls):
                    marker = f"/{MINIO_BUCKET}/"
                    if marker not in public_url:
                        continue
                    storage_path = public_url.split(marker, 1)[1]
                    ok = await store_image(
                        conn, listing["id"], storage_path, public_url, position=i
                    )
                    if ok:
                        stored += 1
                        listing_stored += 1

                if listing_stored:
                    logger.info(
                        f"  {listing['aktenzeichen']}: {listing_stored} Foto(s) gespeichert"
                    )
                else:
                    logger.debug(f"  {listing['aktenzeichen']}: keine Fotos gefunden")

    return stored


# ────────────────────────────────────────────────
# zvg.com Backfill
# ────────────────────────────────────────────────


def _extract_zvg_id(direktlink: str) -> int | None:
    """Extrahiert die zvg.com-Listing-ID aus dem Direktlink."""
    m = re.search(r"/objekt/(\d+)/", direktlink or "")
    if m:
        return int(m.group(1))
    m = re.search(r"[?&]id=(\d+)", direktlink or "")
    return int(m.group(1)) if m else None


def _zvg_com_media_url(path: object) -> str | None:
    raw = str(path).strip()
    if not raw:
        return None
    url = raw if raw.startswith("http") else f"https://www.zvg.com{raw}"
    return assert_image_fetch_url(url)


async def _zvg_com_json(url: str) -> dict | None:
    try:
        resp = await fetch_public_url(
            url,
            timeout_sec=30.0,
            headers=ZVG_COM_HEADERS,
            require_https=True,
            allowed_hosts=ZVG_COM_HOSTS,
        )
        if resp.status_code != 200:
            return None
        data = resp.json()
        return data if isinstance(data, dict) else None
    except Exception as e:
        logger.debug(f"zvg.com JSON-Fetch fehlgeschlagen ({url}): {e}")
        return None


async def _fetch_zvg_com_images(zvg_id: int) -> list[str]:
    """Holt alle Galeriebilder eines zvg.com-Listings."""
    image_urls: list[str] = []
    preview = await _zvg_com_json(f"{ZVG_COM_BASE}/v2024/termine.prg?act=getPic&id={zvg_id}")
    if preview and preview.get("path"):
        url = _zvg_com_media_url(preview["path"])
        if url:
            image_urls.append(url)
    await asyncio.sleep(0.5)

    gallery = await _zvg_com_json(
        f"{ZVG_COM_BASE}/v2024/termine.prg?act=getGalleryPics&id={zvg_id}"
    )
    for path in (gallery or {}).get("data", []):
        url = _zvg_com_media_url(path)
        if url and url not in image_urls:
            image_urls.append(url)

    return image_urls


async def backfill_zvg_com(listings: list[dict], conn: asyncpg.Connection) -> int:
    """Füllt Fotos für zvg.com-Listings nach."""
    stored = 0

    for listing in listings:
        direktlink = listing.get("direktlink", "")
        zvg_id = _extract_zvg_id(direktlink)
        if not zvg_id:
            logger.debug(f"Keine zvg.com-ID für {listing['aktenzeichen']}: {direktlink}")
            continue

        await asyncio.sleep(0.7)
        image_urls = await _fetch_zvg_com_images(zvg_id)

        listing_stored = 0
        for i, img_url in enumerate(image_urls[:5]):
            result = await upload_image(
                img_url,
                listing["bundesland"],
                listing["slug"],
                listing_id=listing["id"],
                position=i,
            )
            if result:
                storage_path, public_url = result
                ok = await store_image(conn, listing["id"], storage_path, public_url, position=i)
                if ok:
                    stored += 1
                    listing_stored += 1

        if listing_stored:
            logger.info(f"  {listing['aktenzeichen']}: {listing_stored} Foto(s) gespeichert")
        else:
            logger.debug(f"  {listing['aktenzeichen']}: keine zvg.com-Fotos")

    return stored


# ────────────────────────────────────────────────
# Main
# ────────────────────────────────────────────────


async def main():
    if not os.environ.get("DATABASE_URL") or not os.environ.get("MINIO_SECRET_KEY"):
        sys.exit(
            "FEHLER: DATABASE_URL und MINIO_SECRET_KEY muessen gesetzt sein "
            "(z.B. per '.venv/bin/python -m dotenv run -- python backfill_photos.py' "
            "oder als Umgebungsvariablen aus der .env)."
        )
    logger.info("=== Gavel Foto-Backfill gestartet ===")

    try:
        ensure_bucket()
        logger.info("MinIO-Bucket sichergestellt")
    except Exception as e:
        logger.error(f"MinIO nicht erreichbar: {e}")
        sys.exit(1)

    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    try:
        listings = await get_listings_without_photos(conn)
        total = len(listings)
        logger.info(f"Listings ohne oder mit weniger als 3 Fotos: {total}")

        if total == 0:
            logger.info("Keine Teilgalerien unter 3 Fotos. Backfill abgeschlossen.")
            return

        portal = [l for l in listings if l["source"] == "justizportal"]
        zvgcom = [l for l in listings if l["source"] == "zvg.com"]

        logger.info(f"  justizportal: {len(portal)}")
        logger.info(f"  zvg.com:      {len(zvgcom)}")

        portal_stored = 0
        if portal:
            portal_stored = await backfill_justizportal(portal, conn)
            logger.info(f"justizportal Backfill: {portal_stored} Foto-Einträge gespeichert")

        zvgcom_stored = 0
        if zvgcom:
            zvgcom_stored = await backfill_zvg_com(zvgcom, conn)
            logger.info(f"zvg.com Backfill: {zvgcom_stored} Foto-Einträge gespeichert")

        # Finale Statistik
        count = await conn.fetchval(
            "SELECT COUNT(DISTINCT listing_id) FROM zvg_images WHERE listing_id IS NOT NULL"
        )
        total_active = await conn.fetchval(
            "SELECT COUNT(*) FROM zvg_listings WHERE ist_aktiv = TRUE"
        )
        logger.info(
            f"\n=== Backfill abgeschlossen ===\n"
            f"  Listings mit Fotos: {count} / {total_active}\n"
            f"  Neu gespeichert:    {portal_stored + zvgcom_stored} Foto-Einträge"
        )

    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
