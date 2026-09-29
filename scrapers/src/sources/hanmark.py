"""
Scraper für hanmark.de (hansen marketing GmbH)
Strategie: httpx + BeautifulSoup4 (statisches HTML, kein JS)

Datenstruktur:
  /bundeslaender.html
    → <table class="directory"> mit <th>BUNDESLAND</th>
    → Zeilen: Amtsgericht-Name + Link zu /amtsgericht-{ID}.html

  /amtsgericht-{ID}.html
    → <table class="sortable"> mit Listings
    → Spalten: Aktenzeichen+AG, Objekttyp, PLZ, Ort, Verkehrswert, Termin
    → Jede Zeile verlinkt auf /wertgutachten-{WG_ID}.html

  /wertgutachten-{WG_ID}.html
    → Key-Value-Tabelle: Amtsgericht, Aktenzeichen, Objekttyp, Straße, PLZ/Ort,
                         Verkehrswert, Termin, Zuschlag ab
    → Bilder: titelbild-hauptansicht-{WG_ID}.jpg, abbildung-{WG_ID}-{N}.jpg

Foto-Logik:
  Hanmark liefert echte Objektfotos als .jpg.
  Titelbild: titelbild-hauptansicht-{ID}.jpg
  Weitere Bilder: abbildung-{ID}.jpg (ganzseitig)
  Vorschaubilder: abbildung-voransicht-{ID}.jpg → werden NICHT heruntergeladen.
"""

import asyncio
import io
import re
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Optional

import httpx
from bs4 import BeautifulSoup
from loguru import logger

from src.utils.user_agent import user_agent
from src.models.zvg import ZvgListing
from src.sources.zvg_portal import _parse_euro
from src.utils.adaptive_selector import find_with_adaptive_fallback
from src.utils.bundesland import normalize_bundesland_slug
from src.utils.listing_kategorie import detect_listing_kategorie as _detect_kategorie
from src.utils.zvg_identity import listing_identity_key, zvg_listing_slug
from src.utils.url_safety import (
    HANMARK_HOSTS,
    UrlSafetyError,
    assert_hanmark_url,
    assert_image_fetch_url,
    fetch_public_url,
)
from src.utils.page_fetch import fetch_page
from src.storage.minio import upload_image_bytes_sync, ensure_bucket

# Analog zu zvg_portal.py läuft der generische Detailseiten-Fetch (GET) über
# page_fetch.fetch_page(); Bildfilter-Regex
# (abbildung-{id}.jpg vs. abbildung-voransicht-*.jpg) und
# VW-Kreuzvalidierung (_extract_vw_from_gutachten_text) laufen unverändert
# als Nachbearbeitung auf dem zurückgelieferten HTML. Echte Bilddownloads
# bleiben auf httpx (rohe Bildbytes für MinIO-Upload nötig, siehe Begründung
# in zvg_portal.py).

BASE_URL = "https://www.hanmark.de"
BUNDESLAENDER_URL = f"{BASE_URL}/bundeslaender.html"
DELAY = 1.5
IMAGE_DELAY = 1.0
MAX_IMAGES = 4

HEADERS = {
    "User-Agent": user_agent(),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "de-DE,de;q=0.9",
    "Referer": BASE_URL + "/",
}

# Mapping hanmark-Bundeslandnamen → interne Slugs
BUNDESLAND_SLUG_MAP = {
    "Bayern": "bayern",
    "Baden-Württemberg": "badenwuerttemberg",
    "Berlin": "berlin",
    "Brandenburg": "brandenburg",
    "Bremen": "bremen",
    "Hamburg": "hamburg",
    "Hessen": "hessen",
    "Mecklenburg-Vorpommern": "mecklenburg-vorpommern",
    "Niedersachsen": "niedersachsen",
    "Nordrhein-Westfalen": "nordrhein-westfalen",
    "Rheinland-Pfalz": "rheinland-pfalz",
    "Saarland": "saarland",
    "Sachsen": "sachsen",
    "Sachsen-Anhalt": "sachsen-anhalt",
    "Schleswig-Holstein": "schleswig-holstein",
    "Thüringen": "thueringen",
}


# ─────────────────────────────────────────────
# Helper-Funktionen
# ─────────────────────────────────────────────


def _extract_vw_from_gutachten_text(soup: BeautifulSoup) -> Optional[int]:
    """
    Extrahiert den Verkehrswert aus dem Gutachten-Textblock auf der Detailseite.

    Hanmark zeigt in der Key-Value-Tabelle manchmal einen reduzierten Wert
    (Mindestgebot bei Wiederholungsterminen), während der Gutachten-Textblock
    den offiziellen Sachverständigen-Wert enthält. Bei Übereinstimmung ist alles
    konsistent; bei Abweichung wird ein WARNING geloggt.

    Erkennt Muster wie:
      "Verkehrswert: 149.000,00"  oder  "Verkehrswert: 149.000"

    WICHTIG (siehe Untersuchung 2026-07-04, Objekt 3-k-11-25-1-hanmark-weissenhorn):
    Bei Zwangsversteigerungen mit mehreren Bestandsverzeichnis-Positionen (z.B. Wohnhaus
    + separat verwertete Hoffläche/Stellplatz/Garage) veröffentlicht hanmark.de für jede
    Position eine EIGENE Wertgutachten-Seite mit eigener Aktenzeichen-Endung ("#1", "#2", …)
    und einem jeweils EIGENEN, für genau dieses Teilobjekt korrekten Verkehrswert. Das
    zugehörige Gesamt-Gutachten-PDF nennt dabei oft BEIDE (bzw. alle) Teilwerte
    (z.B. "Verkehrswert Hoffläche ... 5.000,00" UND "Verkehrswert Wohnhaus BV 3 ... 280.000,00").
    Der Excerpt-Textblock auf der jeweiligen Detailseite selbst enthält nach bisheriger
    Beobachtung aber immer nur den zu DIESER Seite passenden Wert – die Tabelle
    ("Verkehrswert:"-Zeile oben) und der Excerpt-Text stimmen überein.

    Sicherheitsnetz: Werden im Textblock mehrere UNTERSCHIEDLICHE Werte gefunden (was laut
    obiger Beobachtung nicht vorkommen sollte, aber z.B. bei künftigen Layout-Änderungen
    passieren könnte), ist NICHT mehr eindeutig, welcher der laut Seite korrekte ist. In
    diesem Fall wird kein Wert zurückgegeben (None), sodass der Aufrufer die primäre
    Key-Value-Tabelle (die für DIESE spezifische URL/Objekt gepflegt wird) unverändert
    beibehält, statt versehentlich den Verkehrswert eines anderen Teilobjekts zu übernehmen.
    """
    page_text = soup.get_text(" ", strip=True)
    pattern = (
        r"[Vv]erkehrswert[:\s]+([0-9]{1,3}(?:[.,\s][0-9]{3})*(?:[.,][0-9]{1,2})?)\s*(?:€|EUR)?"
    )
    values: list[int] = []
    for m in re.finditer(pattern, page_text):
        parsed = _parse_euro(m.group(1))
        if parsed is not None and parsed > 0:
            values.append(parsed)
    if not values:
        return None

    distinct = set(values)
    if len(distinct) > 1:
        logger.warning(
            f"hanmark: Mehrere unterschiedliche Verkehrswerte im Gutachten-Textblock "
            f"gefunden ({sorted(distinct)}) – nicht eindeutig zuordenbar, Textwert wird "
            f"verworfen (Tabellenwert der Detailseite bleibt maßgeblich)."
        )
        return None

    return values[0]


_BERLIN = ZoneInfo("Europe/Berlin")


def _parse_termin(date_str: str, time_str: str = "") -> Optional[datetime]:
    """'30.06.2026' + '11:00 Uhr' → timezone-aware datetime (Europe/Berlin)"""
    combined = f"{date_str} {time_str}".replace("Uhr", "").strip()
    for fmt in ["%d.%m.%Y %H:%M", "%d.%m.%Y"]:
        try:
            return datetime.strptime(combined.split("  ")[0].strip(), fmt).replace(tzinfo=_BERLIN)
        except ValueError:
            pass
    return None


# ─────────────────────────────────────────────
# Bundesländer + Amtsgerichte laden
# ─────────────────────────────────────────────


async def _fetch_amtsgericht_urls(
    bundesland_filter: Optional[str] = None,
) -> dict[str, list[tuple[str, str, str]]]:
    """
    Scrapt bundeslaender.html.
    Gibt dict zurück: {bundesland_slug: [(ag_name, ag_url, ag_count_str), ...]}
    Wenn bundesland_filter gesetzt ist, werden nur Amtsgerichte dieses Bundeslandes geladen.

    Hinweis: hanmark.de verwendet eine einzige <table class="directory"> mit
    <th>-Zeilen als Bundesland-Trenner (nicht eine Tabelle pro Bundesland).
    """
    result: dict[str, list[tuple[str, str, str]]] = {}

    try:
        resp = await fetch_public_url(
            BUNDESLAENDER_URL,
            timeout_sec=30.0,
            headers=HEADERS,
            require_https=True,
            allowed_hosts=HANMARK_HOSTS,
        )
        resp.raise_for_status()
    except (httpx.HTTPError, UrlSafetyError) as e:
        logger.error(f"hanmark: Fehler beim Laden von bundeslaender.html: {e}")
        return result

    # Einzige directory-Tabelle – Bundesländer werden durch <th>-Zeilen getrennt.
    # Einziger Einstiegspunkt für ALLE Amtsgerichte/Bundesländer - fällt diese
    # Tabelle weg, liefert der gesamte hanmark-Scraper 0 Listings. Daher mit
    # adaptivem Scrapling-Fallback abgesichert (siehe adaptive_selector.py).
    table = find_with_adaptive_fallback(
        resp.text,
        BUNDESLAENDER_URL,
        field_label="hanmark table.directory",
        tag_name="table",
        css_selector="table.directory",
        storage_file="hanmark_selectors.db",
    )
    if not table:
        logger.warning("hanmark: Keine <table class='directory'> auf bundeslaender.html")
        return result

    current_bl_slug: Optional[str] = None

    for row in table.find_all("tr"):
        # Bundesland-Trennzeile: <th colspan="...">BUNDESLAND</th>
        th = row.find("th")
        if th:
            bl_name = th.get_text(strip=True)
            bl_slug = BUNDESLAND_SLUG_MAP.get(bl_name)
            if bl_slug:
                current_bl_slug = bl_slug
                result.setdefault(current_bl_slug, [])
            else:
                logger.debug(f"hanmark: Unbekanntes Bundesland: '{bl_name}'")
                current_bl_slug = None
            continue

        if current_bl_slug is None:
            continue
        if bundesland_filter and current_bl_slug != bundesland_filter:
            continue

        name_td = row.find("td", class_="name")
        info_td = row.find("td", class_="info")
        if not name_td:
            continue

        link = name_td.find("a", href=True)
        if not link:
            continue

        ag_name = link.get_text(strip=True).replace("Amtsgericht ", "")
        ag_url = link["href"]
        if not ag_url.startswith("http"):
            ag_url = f"{BASE_URL}/{ag_url.lstrip('/')}"

        count_str = info_td.get_text(strip=True) if info_td else "0"
        count_match = re.search(r"(\d+)", count_str)
        count = int(count_match.group(1)) if count_match else 0

        if count > 0:
            result[current_bl_slug].append((ag_name, ag_url, count_str))

    return result


# ─────────────────────────────────────────────
# Listings einer Amtsgericht-Seite parsen
# ─────────────────────────────────────────────


def _parse_ag_listings(
    raw_html: str,
    url: str,
    bundesland: str,
    bundesland_name: str,
) -> list[dict]:
    """
    Parst die Listings-Tabelle auf einer Amtsgericht-Seite.
    Sucht nach <table class="listing"> (aktuell) oder <table class="sortable"> (Legacy) -
    kritischster Einzelpunkt dieser Seite (ohne Treffer 0 Listings für das
    ganze Amtsgericht), daher über den adaptiven Scrapling-Selector gesucht
    statt direkt per BeautifulSoup (siehe adaptive_selector.py).
    """
    table = find_with_adaptive_fallback(
        raw_html,
        url,
        field_label="hanmark table.listing/.sortable",
        tag_name="table",
        css_selector="table.listing, table.sortable",
        storage_file="hanmark_selectors.db",
    )
    if not table:
        return []

    rows = table.find_all("tr")
    listings = []

    for row in rows[1:]:  # Header überspringen
        cells = row.find_all("td")
        if len(cells) < 6:
            continue

        # Spalte 1: AZ + AG (bspw. "1 K 65/25\nAG Eggenfelden")
        az_cell = cells[1]
        cell_text = az_cell.get_text("\n", strip=True)
        lines = [l.strip() for l in cell_text.split("\n") if l.strip()]

        if len(lines) >= 2:
            az_raw = lines[0]
            ag_raw = lines[1]
        elif lines:
            az_raw = lines[0]
            ag_raw = ""
        else:
            continue

        # Direktlink (alle Links in dieser Zelle verweisen auf dasselbe Wertgutachten)
        link = az_cell.find("a", href=True)
        direktlink = None
        if link:
            href = link["href"]
            direktlink = href if href.startswith("http") else f"{BASE_URL}/{href.lstrip('/')}"

        typ = cells[2].get_text(strip=True)
        plz = cells[3].get_text(strip=True)
        ort = cells[4].get_text(strip=True)
        vw_text = cells[5].get_text(strip=True)

        # Termin (Spalte 6): "30.06.202611:00 Uhr" ODER "Termin aufgehoben"
        # (hanmark.de zeigt bei aufgehobenen Terminen hier explizit "Termin aufgehoben" statt eines
        # Datums - HTTP 200, kein 404, daher sonst leicht übersehbar).
        termin_raw = cells[6].get_text(strip=True) if len(cells) > 6 else ""
        termin_aufgehoben = "aufgehoben" in termin_raw.lower()
        m = re.match(r"(\d{2}\.\d{2}\.\d{4})\s*(.*)", termin_raw)
        termin = None
        if m:
            termin = _parse_termin(m.group(1), m.group(2))

        # Amtsgericht aus Zelle 1 bereinigen ("AG Eggenfelden" → "Eggenfelden")
        amtsgericht = ag_raw.replace("AG ", "").strip()

        slug = zvg_listing_slug(
            az_raw,
            bundesland,
            amtsgericht=amtsgericht,
            ort=ort or plz,
            marker="hanmark",
        )

        listings.append(
            {
                "aktenzeichen": az_raw,
                "amtsgericht": amtsgericht,
                "typ": typ,
                "plz": plz,
                "ort": ort,
                "verkehrswert": _parse_euro(vw_text),
                "termin": termin,
                "termin_aufgehoben": termin_aufgehoben,
                "direktlink": direktlink,
                "slug": slug,
                "bundesland": bundesland,
                "bundesland_name": bundesland_name,
            }
        )

    return listings


# ─────────────────────────────────────────────
# Detailseite parsen (Straße + Bilder)
# ─────────────────────────────────────────────


async def _fetch_detail_html(client: httpx.AsyncClient, detail_url: str) -> Optional[str]:
    """
    Holt das HTML einer Wertgutachten-Detailseite. Primärpfad: fetch_page,
    Fallback auf httpx bei Fehler/leerem Ergebnis (siehe Modul-Docstring).
    """
    try:
        detail_url = assert_hanmark_url(detail_url)
    except UrlSafetyError:
        logger.warning(f"hanmark: Detail-URL abgelehnt: {detail_url}")
        return None

    try:
        result = await fetch_page(
            detail_url,
            headers=HEADERS,
            allowed_hosts=HANMARK_HOSTS,
        )
        if result.success and len(result.raw_html) >= 50:
            return result.raw_html
        logger.debug(
            f"hanmark: fetch_page unzureichend (success={result.success}, "
            f"len={len(result.raw_html)}) – Fallback auf httpx: {detail_url}"
        )
    except Exception as e:
        logger.warning(
            f"hanmark: fetch_page fehlgeschlagen, Fallback auf httpx ({detail_url}): {e}"
        )

    try:
        resp = await fetch_public_url(
            detail_url,
            timeout_sec=30.0,
            headers=HEADERS,
            require_https=True,
            allowed_hosts=HANMARK_HOSTS,
        )
        resp.raise_for_status()
        return resp.text
    except (httpx.HTTPError, UrlSafetyError) as e:
        logger.debug(f"hanmark detail: {e} – {detail_url}")
        return None


async def _enrich_from_detail(
    client: httpx.AsyncClient,
    detail_url: str,
    bundesland: str,
    slug: str,
    fetch_images: bool = True,
) -> dict:
    """
    Ruft die Detailseite ab und extrahiert Straße, Gutachten-URL, Bilder.
    Gibt ein dict mit zusätzlichen Feldern zurück.
    """
    extra: dict = {}
    if not detail_url:
        return extra

    await asyncio.sleep(IMAGE_DELAY)
    html = await _fetch_detail_html(client, detail_url)
    if html is None:
        return extra

    soup = BeautifulSoup(html, "html.parser")

    # Key-Value-Tabelle auslesen
    # Hanmark-Detailseite verwendet <th> für Keys und <td> für Values
    for row in soup.find_all("tr"):
        th = row.find("th")
        td = row.find("td")
        if not th or not td:
            continue
        key = th.get_text(strip=True).lower().rstrip(":")
        val = td.get_text(strip=True)
        if "straße" in key or "strasse" in key:
            extra["strasse"] = val
        elif key == "termin" and "aufgehoben" in val.lower():
            # Detailseite zeigt bei
            # aufgehobenen Terminen hier nur "aufgehoben" statt eines Datums.
            extra["termin_aufgehoben"] = True
        elif "gavel" in key:
            extra["gavel_ab"] = val
        elif "verkehrswert" in key:
            parsed_vw = _parse_euro(val)
            if parsed_vw is not None:
                extra["verkehrswert"] = parsed_vw
        elif "amtsgericht" in key:
            extra["amtsgericht"] = val
        elif "plz" in key or "ort" in key:
            parts = val.strip().split(" ", 1)
            if len(parts) == 2 and parts[0].isdigit():
                extra["plz"] = parts[0]
                extra["ort"] = parts[1]

    # Kreuzvalidierung: VW aus Gutachten-Textblock vs. Key-Value-Tabelle
    vw_text = _extract_vw_from_gutachten_text(soup)
    if vw_text is not None:
        vw_table = extra.get("verkehrswert")
        if vw_table is not None and vw_text != vw_table:
            ratio = max(vw_text, vw_table) / max(min(vw_text, vw_table), 1)
            if ratio >= 3:
                logger.warning(
                    f"hanmark VW-Abweichung [{slug}]: "
                    f"Tabelle={vw_table:,} € vs. Gutachten-Text={vw_text:,} € "
                    f"(Faktor {ratio:.1f}x) → Gutachten-Wert wird bevorzugt"
                )
                extra["verkehrswert"] = vw_text
        elif vw_table is None:
            extra["verkehrswert"] = vw_text

    # Gutachten-PDF - über adaptiven Scrapling-Selector gesucht (siehe
    # adaptive_selector.py), da ohne diesen Link keine Gutachten-Werte/-Texte
    # für diese Immobilie verfügbar wären.
    pdf_link = find_with_adaptive_fallback(
        html,
        detail_url,
        field_label="hanmark Gutachten-PDF-Link",
        tag_name="a",
        css_selector='a[href*="wertgutachten"]',
        storage_file="hanmark_selectors.db",
    )
    if pdf_link:
        href = pdf_link["href"]
        candidate = href if href.startswith("http") else f"{BASE_URL}/{href.lstrip('/')}"
        try:
            extra["gutachten_url"] = assert_hanmark_url(candidate, resolve_dns=False)
        except UrlSafetyError:
            logger.warning(f"hanmark: Gutachten-URL abgelehnt: {candidate}")

    if not fetch_images:
        return extra

    # Bilder herunterladen
    # Muster: abbildung-{ID}.jpg (Vollbilder, NICHT voransicht)
    image_urls: list[str] = []
    imgs = soup.find_all("img", src=re.compile(r"abbildung-(?!voransicht)\d+\.jpg$"))
    imgs += soup.find_all("img", src=re.compile(r"titelbild-hauptansicht-\d+\.jpg$"))

    seen_srcs: set[str] = set()
    position = 0

    for img in imgs[:MAX_IMAGES]:
        src = img.get("src", "")
        if not src or src in seen_srcs:
            continue
        seen_srcs.add(src)
        img_url = src if src.startswith("http") else f"{BASE_URL}/{src.lstrip('/')}"

        img_bytes = await _download_image(client, img_url, referer=detail_url)
        if not img_bytes:
            continue

        result = upload_image_bytes_sync(
            img_bytes, "image/jpeg", bundesland, slug, position=position
        )
        if result:
            _, public_url = result
            image_urls.append(public_url)
            logger.debug(f"hanmark: Foto {position} hochgeladen: {public_url}")
            position += 1

    if image_urls:
        extra["image_urls"] = image_urls

    return extra


async def _download_image(
    client: httpx.AsyncClient,
    url: str,
    referer: str = BASE_URL,
) -> Optional[bytes]:
    safe = assert_image_fetch_url(url)
    if not safe:
        return None
    try:
        await asyncio.sleep(IMAGE_DELAY)
        resp = await fetch_public_url(
            safe,
            timeout_sec=30.0,
            headers={**HEADERS, "Referer": referer},
            require_https=False,
        )
        resp.raise_for_status()

        ct = resp.headers.get("content-type", "").split(";")[0].strip().lower()
        content = resp.content

        if len(content) <= 10:
            return None

        if ct in ("image/jpeg", "image/jpg"):
            return content
        if ct in ("image/png", "image/webp"):
            from PIL import Image

            img = Image.open(io.BytesIO(content))
            buf = io.BytesIO()
            img.convert("RGB").save(buf, format="JPEG", quality=85)
            return buf.getvalue()

        logger.debug(f"hanmark: Unbekannter Content-Type {ct} – {url}")
        return None

    except Exception as e:
        logger.debug(f"hanmark: Bild-Download fehlgeschlagen ({url}): {e}")
        return None


# ─────────────────────────────────────────────
# Haupt-Entry-Point
# ─────────────────────────────────────────────


async def scrape_bundesland(
    bundesland: str,
    fetch_images: bool = True,
) -> list[ZvgListing]:
    """
    Scrapt alle hanmark.de-Listings für ein einzelnes Bundesland.

    Args:
        bundesland: Interner Slug, z.B. "bayern", "nordrhein-westfalen"
        fetch_images: Echte Fotos von der Detailseite laden und in MinIO speichern

    Returns:
        Liste von ZvgListing-Objekten
    """
    if fetch_images:
        try:
            ensure_bucket()
        except Exception as e:
            logger.warning(f"hanmark: MinIO-Bucket-Fehler (Fotos werden übersprungen): {e}")
            fetch_images = False

    all_listings: list[ZvgListing] = []
    seen_ids: set[tuple[str, str, str]] = set()

    async with httpx.AsyncClient(headers=HEADERS, follow_redirects=False, timeout=30) as client:
        # 1. Amtsgerichte für das Bundesland holen
        ag_map = await _fetch_amtsgericht_urls(bundesland_filter=bundesland)
        ag_list = ag_map.get(bundesland, [])

        if not ag_list:
            logger.info(f"hanmark: Keine Amtsgerichte mit Listings für {bundesland}")
            return []

        bl_name = next(
            (k for k, v in BUNDESLAND_SLUG_MAP.items() if v == bundesland), bundesland.title()
        )
        logger.info(f"hanmark: {bundesland} – {len(ag_list)} Amtsgerichte mit Listings")

        # 2. Jede Amtsgericht-Seite scrapen
        for ag_name, ag_url, ag_count in ag_list:
            await asyncio.sleep(DELAY)

            try:
                ag_url = assert_hanmark_url(ag_url)
            except UrlSafetyError:
                logger.warning(f"hanmark: Amtsgericht-URL abgelehnt ({ag_name}): {ag_url}")
                continue

            try:
                resp = await fetch_public_url(
                    ag_url,
                    timeout_sec=30.0,
                    headers=HEADERS,
                    require_https=True,
                    allowed_hosts=HANMARK_HOSTS,
                )
                resp.raise_for_status()
            except (httpx.HTTPError, UrlSafetyError) as e:
                logger.warning(f"hanmark: HTTP-Fehler {ag_name}: {e}")
                continue

            raw_listings = _parse_ag_listings(resp.text, ag_url, bundesland, bl_name)
            logger.info(f"hanmark: {ag_name}: {len(raw_listings)} Listings")

            # 3. Je Listing optional Detailseite anreichern
            for raw in raw_listings:
                known = listing_identity_key(
                    bundesland,
                    raw.get("amtsgericht") or ag_name,
                    raw["aktenzeichen"],
                )
                if known[1] and known in seen_ids:
                    continue
                extra: dict = {}
                if raw.get("direktlink"):
                    await asyncio.sleep(DELAY * 0.5)
                    extra = await _enrich_from_detail(
                        client,
                        raw["direktlink"],
                        bundesland,
                        raw["slug"],
                        fetch_images=fetch_images,
                    )

                # Adresse zusammenbauen (Detail-Seite hat ggf. genauere PLZ/Ort-Infos)
                strasse = extra.get("strasse") or ""
                plz = extra.get("plz") or raw.get("plz") or ""
                ort = extra.get("ort") or raw.get("ort") or ""
                adresse_parts = [p for p in [strasse, plz, ort] if p]
                adresse = ", ".join(adresse_parts) if adresse_parts else ort

                # Amtsgericht: Detail-Seite bevorzugen, sonst ag_name aus dem Outer-Loop
                amtsgericht = extra.get("amtsgericht") or raw.get("amtsgericht") or ag_name
                identity = listing_identity_key(bundesland, amtsgericht, raw["aktenzeichen"])
                if identity in seen_ids:
                    continue
                seen_ids.add(identity)
                slug = zvg_listing_slug(
                    raw["aktenzeichen"],
                    bundesland,
                    amtsgericht=amtsgericht,
                    ort=ort or plz,
                    marker="hanmark",
                )

                # Verkehrswert: Detail-Seite bevorzugen (hat Komma-Format: "149.000,00 EUR")
                verkehrswert = extra.get("verkehrswert") or raw.get("verkehrswert")

                # "aufgehoben"-Signal von
                # Listen- ODER Detailseite reicht (z.B. bei fehlendem
                # direktlink liefert nur die Listenseite ein Signal).
                termin_aufgehoben = bool(
                    raw.get("termin_aufgehoben") or extra.get("termin_aufgehoben")
                )

                listing = ZvgListing(
                    aktenzeichen=raw["aktenzeichen"],
                    # Normalisierung als Sicherheitsnetz (siehe
                    # src/utils/bundesland.py), analog zu zvg_portal.py/zvg_com.py.
                    bundesland=normalize_bundesland_slug(bundesland),
                    bundesland_name=bl_name,
                    slug=slug,
                    source="hanmark.de",
                    source_url=ag_url,
                    direktlink=raw.get("direktlink"),
                    typ=raw.get("typ"),
                    kategorie=_detect_kategorie(raw.get("typ", "")),
                    adresse=adresse,
                    strasse=strasse or None,
                    plz=plz or None,
                    ort=ort or None,
                    verkehrswert=verkehrswert,
                    amtsgericht=amtsgericht or None,
                    termin_date=raw.get("termin"),
                    termin_aufgehoben=termin_aufgehoben,
                    ist_neu=True,
                    image_urls=extra.get("image_urls", []),
                    gutachten_url=extra.get("gutachten_url"),
                    # Vollständigkeits-Gate (0006): Detailseite wurde versucht
                    # (KV/Gutachten-Text auch ohne MinIO). Nur Uploads hängen
                    # an fetch_images, nicht die KI-Freigabe.
                    detail_scrape_complete=True,
                )

                all_listings.append(listing)

        photos_total = sum(1 for l in all_listings if l.image_urls)
        logger.info(
            f"hanmark: Fertig {bundesland} – {len(all_listings)} Listings, {photos_total} mit Fotos"
        )

    return all_listings


async def scrape_all(fetch_images: bool = True) -> list[ZvgListing]:
    """
    Scrapt alle Bundesländer von hanmark.de.
    Nützlich für den täglichen Batch-Lauf.
    """
    all_listings: list[ZvgListing] = []
    for bl_slug in BUNDESLAND_SLUG_MAP.values():
        try:
            listings = await scrape_bundesland(bl_slug, fetch_images=fetch_images)
            all_listings.extend(listings)
            logger.info(f"hanmark scrape_all: {bl_slug} fertig ({len(listings)} Listings)")
            await asyncio.sleep(DELAY)
        except Exception as e:
            logger.error(f"hanmark scrape_all: Fehler bei {bl_slug}: {e}")
    return all_listings
