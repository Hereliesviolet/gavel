"""
Scraper für zvg.com
Strategie: Direkte JSON-API (kein Browser nötig)

API-Endpunkte:
  GET /v2024/bundesland.prg?act=getData              → Alle Bundesland-IDs
  GET /v2024/termine.prg?act=getGridJson             → ALLE Listings (alle BL, inkl. aufgehobene)
  GET /v2024/termine.prg?act=getGridJson&id_b=X      → Listings eines Bundeslandes (Fallback)
  GET /v2024/termine.prg?act=getGalleryPics&id=X     → Galeriebilder
  GET /v2024/termine.prg?act=getPDF&id=X             → PDF-Pfad (Fallback für Gutachten)
  GET /v2024/termine.prg?act=getJSON&id=X            → Detaildaten (inkl. Expose-Feld)

Jedes Grid-Item enthält: id, az, img, gutachten, street, plz, city, vwert, date, ag, terminAufgehoben
"""

import asyncio
import re
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Optional

import httpx
from loguru import logger

from src.utils.user_agent import user_agent
from src.models.zvg import ZvgListing
from src.utils.bundesland import normalize_bundesland_slug
from src.utils.listing_kategorie import detect_listing_kategorie as _detect_kategorie
from src.utils.zvg_identity import listing_identity_key, zvg_listing_slug
from src.utils.url_safety import (
    UrlSafetyError,
    ZVG_COM_HOSTS,
    assert_zvg_com_url,
    fetch_public_request,
)

BASE_URL = "https://zvg.com"
WWW_BASE_URL = "https://www.zvg.com"
DELAY = 0.5

HEADERS = {
    "User-Agent": user_agent(),
    "Accept": "application/json, */*",
    "Accept-Language": "de-DE,de;q=0.9",
    "Referer": "https://zvg.com/",
}


_BERLIN = ZoneInfo("Europe/Berlin")


def _parse_termin(date_str: str, time_str: str) -> Optional[datetime]:
    """'27.08.2026' + '10:00' → timezone-aware datetime (Europe/Berlin)"""
    if not date_str:
        return None
    try:
        s = f"{date_str.strip()} {time_str.strip()}" if time_str else date_str.strip()
        for fmt in ["%d.%m.%Y %H:%M", "%d.%m.%Y"]:
            try:
                return datetime.strptime(s, fmt).replace(tzinfo=_BERLIN)
            except ValueError:
                pass
    except Exception:
        pass
    return None


def _make_absolute_url(path: str) -> str:
    """Relativen Pfad zu absolutem URL machen. Nur zvg.com-Hosts."""
    if not path:
        return ""
    if path.startswith("http"):
        url = path
    elif path.startswith("/bilder/") or path.startswith("/content/"):
        url = f"{WWW_BASE_URL}{path}"
    else:
        url = f"{BASE_URL}{path}"
    try:
        return assert_zvg_com_url(url, resolve_dns=False)
    except UrlSafetyError:
        return ""


async def _zvg_com_get(url: str, *, timeout_sec: float = 30.0) -> httpx.Response:
    return await fetch_public_request(
        "GET",
        url,
        timeout_sec=timeout_sec,
        headers=HEADERS,
        allowed_hosts=ZVG_COM_HOSTS,
    )


async def _fetch_all_listings_global() -> list[dict]:
    """
    Holt alle Listings über den globalen getGridJson-Endpunkt (ohne id_b).
    Dies gibt alle 556+ Listings über alle Bundesländer in einem API-Aufruf zurück.
    """
    try:
        r = await _zvg_com_get(f"{BASE_URL}/v2024/termine.prg?act=getGridJson")
        r.raise_for_status()
        data = r.json()
        if isinstance(data, list):
            logger.info(f"getGridJson (global): {len(data)} Listings erhalten")
            return data
        logger.warning(f"Unerwartetes Format: {type(data)}")
        return []
    except Exception as e:
        logger.error(f"Fehler beim globalen getGridJson: {e}")
        return []


async def _fetch_bundeslaender() -> dict[str, int]:
    """Holt alle aktiven Bundesland-IDs von zvg.com (Fallback)."""
    r = await _zvg_com_get(f"{BASE_URL}/v2024/bundesland.prg?act=getData")
    r.raise_for_status()
    data = r.json()
    return {
        bl["Name"]: bl["Lfd"]
        for bl in data.get("data", [])
        if bl.get("Aktiv") == 1 and bl.get("Name")
    }


async def _fetch_listings_for_bundesland(bl_name: str, bl_id: int) -> list[dict]:
    """Holt alle Listings für ein Bundesland via getGridJson-API (Fallback)."""
    await asyncio.sleep(DELAY)
    try:
        r = await _zvg_com_get(f"{BASE_URL}/v2024/termine.prg?act=getGridJson&id_b={bl_id}")
        r.raise_for_status()
        data = r.json()
        if isinstance(data, list):
            return data
        logger.warning(f"Unerwartetes Format für {bl_name}: {type(data)}")
        return []
    except Exception as e:
        logger.warning(f"Fehler beim Laden von {bl_name} (id_b={bl_id}): {e}")
        return []


async def _fetch_gallery_images(listing_id: int) -> list[str]:
    """
    Holt alle Galeriebilder über getGalleryPics-Endpunkt.
    Gibt Liste von absoluten Bild-URLs zurück.
    """
    try:
        r = await _zvg_com_get(f"{BASE_URL}/v2024/termine.prg?act=getGalleryPics&id={listing_id}")
        r.raise_for_status()
        data = r.json()
        paths = data.get("data", [])
        return [_make_absolute_url(p) for p in paths if p]
    except Exception as e:
        logger.debug(f"getGalleryPics für ID {listing_id} fehlgeschlagen: {e}")
        return []


async def _fetch_gutachten_url(
    listing_id: int,
    gutachten_from_grid: str = "",
) -> str:
    """
    Ermittelt die Gutachten-URL. Bevorzugt den Pfad aus getGridJson,
    fällt auf getPDF zurück.
    """
    if gutachten_from_grid:
        return _make_absolute_url(gutachten_from_grid)

    try:
        r = await _zvg_com_get(f"{BASE_URL}/v2024/termine.prg?act=getPDF&id={listing_id}")
        r.raise_for_status()
        data = r.json()
        pdf_path = data.get("pdf", "")
        if pdf_path:
            return _make_absolute_url(pdf_path)
    except Exception as e:
        logger.debug(f"getPDF für ID {listing_id} fehlgeschlagen: {e}")

    return ""


async def _fetch_expose_url(listing_id: int) -> Optional[str]:
    """
    Ermittelt die Expose-URL via act=getPDF (expose-Feld in der Antwort).

    Der Endpunkt /v2024/termine.prg?act=getPDF&id=X liefert:
    {
        "pdf":    "https://www.zvg.com/content/pdfaz/G...pdf",  ← Gutachten
        "expose": "https://www.zvg.com/bilder/.../Kurzbeschreibung_...pdf",  ← Expose (oder "")
        ...
    }
    """
    try:
        r = await _zvg_com_get(
            f"{BASE_URL}/v2024/termine.prg?act=getPDF&id={listing_id}",
            timeout_sec=10,
        )
        if r.status_code == 200:
            data = r.json()
            expose_val = data.get("expose", "")
            if expose_val:
                return _make_absolute_url(str(expose_val)) or None
    except Exception as e:
        logger.debug(f"getPDF für ID {listing_id} fehlgeschlagen: {e}")

    return None


def _build_zvg_listing(item: dict, bl_name: str, expose_url: Optional[str] = None) -> ZvgListing:
    """Baut ein ZvgListing-Objekt aus einem getGridJson-Item."""
    listing_id = item.get("id", 0)
    az = item.get("az", "").strip()
    typ = (
        item.get("title", "").split(":", 1)[-1].strip()
        if ":" in item.get("title", "")
        else item.get("title", "")
    )
    objektart = typ

    street = item.get("street", "") or ""
    plz = item.get("plz", "") or ""
    city = item.get("city", "") or ""
    adresse_parts = [p for p in [street, f"{plz} {city}".strip()] if p]
    adresse = ", ".join(adresse_parts) or city

    ag = item.get("ag", "") or ""
    vwert = item.get("vwert") or None
    gpreis = item.get("gpreis") or 0

    gericht_info = item.get("gericht", {}) or {}
    bundesland_from_api = gericht_info.get("bundesland", bl_name) or bl_name

    termin_str = item.get("date", "") or ""
    time_str = item.get("time", "") or ""
    termin = _parse_termin(termin_str, time_str)

    img_path = item.get("img", "") or ""
    image_urls: list[str] = []
    if img_path:
        image_urls.append(_make_absolute_url(img_path))

    gutachten_path = item.get("gutachten", "") or ""
    gutachten_url = _make_absolute_url(gutachten_path) if gutachten_path else None

    # Bug-Fix (2026-07-04): Statt des generischen _slugify() (das
    # "Baden-Württemberg" zu "baden-wuerttemberg" MIT Bindestrich machte,
    # abweichend von der App-weiten kanonischen Schreibweise
    # "badenwuerttemberg") wird jetzt die zentrale, mit dem Web-Frontend
    # geteilte Normalisierung verwendet. Das behebt zugleich Fälle, in denen
    # `bl_name` mangels "gericht.bundesland" im API-Response auf den
    # Amtsgerichtsnamen zurückfiel (z.B. "Gotha", "Ludwigshafen am Rhein"
    # statt "Thüringen"/"Rheinland-Pfalz") - bekannte Fälle sind in
    # src/utils/bundesland.py als Alias hinterlegt.
    bl_slug = normalize_bundesland_slug(bl_name)
    slug = zvg_listing_slug(az, bl_slug, amtsgericht=ag, ort=city or ag)

    kategorie = _detect_kategorie(objektart)

    listing = ZvgListing(
        aktenzeichen=az or f"zvg-{listing_id}",
        bundesland=bl_slug,
        bundesland_name=bundesland_from_api or bl_name,
        slug=slug,
        source="zvg.com",
        source_url=f"{BASE_URL}/objekt/{listing_id}/show",
        direktlink=f"{BASE_URL}/objekt/{listing_id}/show",
        typ=objektart or None,
        kategorie=kategorie,
        adresse=adresse or None,
        strasse=street or None,
        plz=plz or None,
        ort=city or None,
        amtsgericht=ag or None,
        verkehrswert=int(vwert) if vwert else None,
        termin_date=termin,
        ist_neu=True,
        image_urls=image_urls,
        gutachten_url=gutachten_url,
        expose_url=expose_url,
        raw_data={
            "zvg_id": listing_id,
            "title": item.get("title", ""),
            "gpreis": gpreis,
            "terminAufgehoben": item.get("terminAufgehoben", 0),
            "dateAdded": item.get("dateAdded", ""),
        },
    )
    return listing


async def scrape_aufgehoben() -> list[int]:
    """
    Gibt alle zvg_ids zurück, deren Termin aufgehoben wurde (terminAufgehoben == 1).
    Nutzt den globalen getGridJson-Endpunkt.
    """
    raw_items = await _fetch_all_listings_global()
    aufgehoben_ids = [
        item["id"] for item in raw_items if item.get("terminAufgehoben", 0) == 1 and item.get("id")
    ]
    logger.info(f"zvg.com: {len(aufgehoben_ids)} aufgehobene Termine gefunden")
    return aufgehoben_ids


async def scrape_all(
    fetch_additional_images: bool = True,
    max_listings: Optional[int] = None,
) -> tuple[list[ZvgListing], list[int]]:
    """
    Scrapt alle aktuellen ZVG-Listings von zvg.com.

    Strategie: Globaler getGridJson-Endpunkt (alle BL in einem Aufruf) statt
    pro-Bundesland-Abruf. Dies erfasst zuverlässig alle 556+ Listings.

    Args:
        fetch_additional_images: Ob Galeriebilder + Expose über separate API-Calls
                                  nachgeladen werden.
        max_listings: Auf N Listings begrenzen (für Tests).

    Returns:
        Tuple aus (aktive ZvgListings, aufgehobene zvg_ids)
    """
    all_listings: list[ZvgListing] = []
    aufgehoben_ids: list[int] = []

    # Alle Listings auf einmal laden
    raw_items = await _fetch_all_listings_global()
    if not raw_items:
        logger.warning("zvg.com: Keine Listings vom globalen Endpunkt – Fallback auf BL-weise")
        raw_items = await _fetch_all_via_bundeslaender()

    if max_listings:
        raw_items = raw_items[:max_listings]

    # Aufgehobene IDs sammeln
    for item in raw_items:
        if item.get("terminAufgehoben", 0) == 1 and item.get("id"):
            aufgehoben_ids.append(item["id"])

    # Nur aktive verarbeiten
    active_items = [
        item
        for item in raw_items
        if item.get("terminAufgehoben", 0) == 0 and item.get("active", 1) == 1
    ]

    logger.info(
        f"zvg.com: {len(raw_items)} gesamt, "
        f"{len(active_items)} aktiv, {len(aufgehoben_ids)} aufgehoben"
    )

    seen_ids: set[tuple[str, str, str]] = set()
    scraped_zvg_ids: set[int] = set()

    for item in active_items:
        zvg_id = item.get("id", 0)
        bl_name = (item.get("gericht") or {}).get("bundesland", "") or item.get("ag", "unbekannt")

        try:
            listing = _build_zvg_listing(item, bl_name)
        except Exception as e:
            logger.warning(f"Fehler beim Parsen von Item {zvg_id}: {e}")
            continue

        identity = listing_identity_key(
            listing.bundesland, listing.amtsgericht, listing.aktenzeichen
        )
        if identity in seen_ids:
            continue
        seen_ids.add(identity)
        scraped_zvg_ids.add(zvg_id)

        if fetch_additional_images and zvg_id:
            await asyncio.sleep(DELAY)

            # Alle Galeriebilder laden
            gallery_images = await _fetch_gallery_images(zvg_id)
            existing = set(listing.image_urls)
            all_images = list(listing.image_urls)
            for img in gallery_images:
                if img not in existing:
                    all_images.append(img)
                    existing.add(img)
            if all_images != list(listing.image_urls):
                listing = listing.model_copy(update={"image_urls": all_images})

            # Gutachten-URL finalisieren
            gutachten_from_grid = item.get("gutachten", "")
            final_gutachten = await _fetch_gutachten_url(zvg_id, gutachten_from_grid)
            if final_gutachten and final_gutachten != listing.gutachten_url:
                listing = listing.model_copy(update={"gutachten_url": final_gutachten})

            # Expose-URL ermitteln
            expose_url = await _fetch_expose_url(zvg_id)
            if expose_url:
                listing = listing.model_copy(update={"expose_url": expose_url})

        # Vollständigkeits-Gate (0006, siehe docs/CUSTOM_URL_ANALYSIS.md):
        # detail_scrape_complete bleibt hier bewusst False (Default). Anders
        # als bei zvg_portal.py/hanmark.py ist bei zvg.com der eigentliche
        # PDF-/Bild-DOWNLOAD (MinIO-Upload) noch NICHT abgeschlossen, wenn
        # scrape_all() zurückkehrt - das übernimmt zvg_com_daily.py NACH dem
        # Upsert (mit bekannter listing_id). scrape_completed_at wird daher
        # dort explizit per mark_scrape_completed() gesetzt, NICHT hier.
        all_listings.append(listing)

    logger.info(
        f"zvg.com Gesamt: {len(all_listings)} aktive Listings, "
        f"{sum(1 for l in all_listings if l.gutachten_url)} mit Gutachten, "
        f"{sum(1 for l in all_listings if l.expose_url)} mit Expose"
    )

    return all_listings, aufgehoben_ids


async def _fetch_all_via_bundeslaender() -> list[dict]:
    """Fallback: Listings pro Bundesland abrufen und zusammenführen."""
    all_items: list[dict] = []
    seen_ids: set[int] = set()
    try:
        bundeslaender = await _fetch_bundeslaender()
    except Exception as e:
        logger.error(f"Fehler beim Laden der Bundesländer: {e}")
        return []

    for bl_name, bl_id in bundeslaender.items():
        items = await _fetch_listings_for_bundesland(bl_name, bl_id)
        for item in items:
            if item.get("id") not in seen_ids:
                seen_ids.add(item["id"])
                all_items.append(item)

    return all_items


async def scrape_single_listing(listing_id: int) -> Optional[ZvgListing]:
    """Scrapt ein einzelnes Listing anhand der ID."""
    try:
        r = await _zvg_com_get(f"{BASE_URL}/v2024/termine.prg?act=getJSON&id={listing_id}")
        r.raise_for_status()
        data = r.json()

        if data.get("status") != 1:
            logger.warning(f"ID {listing_id}: Status != 1")
            return None

        r_bl = await _zvg_com_get(
            f"{BASE_URL}/v2024/termine.prg?act=getGerichtJSON&id={listing_id}"
        )
        bl_data = r_bl.json() if r_bl.status_code == 200 else {}
        bl_name = bl_data.get("bundesland", "")

        item = {
            "id": listing_id,
            "az": data.get("Aktenzeichen", ""),
            "title": data.get("Objektart", ""),
            "street": data.get("Objektanschrift", "").split(",")[0]
            if data.get("Objektanschrift")
            else "",
            "plz": "",
            "city": "",
            "vwert": data.get("vwert"),
            "date": data.get("Termin", ""),
            "time": data.get("Zeit", ""),
            "ag": bl_data.get("text", ""),
            "gericht": {"bundesland": bl_name},
            "img": "",
            "gutachten": data.get("Gutachten", ""),
            "terminAufgehoben": 0,
            "active": 1,
            "dateAdded": "",
            "gpreis": data.get("gpreis", 0),
        }

        mapsadresse = data.get("Mapsadresse", "") or data.get("Objektanschrift", "")
        plz_match = re.search(r"(\d{5})\s+([\w\s\-äöüÄÖÜß]+)", mapsadresse)
        if plz_match:
            item["plz"] = plz_match.group(1)
            item["city"] = plz_match.group(2).strip()

        listing = _build_zvg_listing(item, bl_name or "unbekannt")

        r_pic = await _zvg_com_get(f"{BASE_URL}/v2024/termine.prg?act=getPic&id={listing_id}")
        if r_pic.status_code == 200:
            pic_data = r_pic.json()
            if pic_data.get("path"):
                listing = listing.model_copy(
                    update={"image_urls": [_make_absolute_url(pic_data["path"])]}
                )

        gallery_images = await _fetch_gallery_images(listing_id)
        if gallery_images:
            existing = set(listing.image_urls)
            all_images = list(listing.image_urls)
            for img in gallery_images:
                if img not in existing:
                    all_images.append(img)
                    existing.add(img)
            listing = listing.model_copy(update={"image_urls": all_images})

        gutachten_grid = data.get("Gutachten", "")
        gutachten_url = await _fetch_gutachten_url(listing_id, gutachten_grid)
        if gutachten_url:
            listing = listing.model_copy(update={"gutachten_url": gutachten_url})

        expose_url = await _fetch_expose_url(listing_id)
        if expose_url:
            listing = listing.model_copy(update={"expose_url": expose_url})

        return listing
    except Exception as e:
        logger.error(f"Fehler beim Laden von ID {listing_id}: {e}")
        return None
