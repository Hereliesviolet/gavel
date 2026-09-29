"""
Scraper für zvg-portal.de (Justizportal des Bundes)
Strategie: httpx + BeautifulSoup4 (POST-Formular)
Tabellenstruktur: Key-Value-Rows pro Objekt (kein klassisches Grid)

Foto-Logik:
  zvg-portal.de liefert ausschließlich PDF-Dokumente (Terminsbestimmungen,
  Grundbuchauszüge etc.) – keine echten Objektfotos.
  PDFs werden NICHT konvertiert und NICHT als Bilder gespeichert.
  Nur falls ein Listing direkt .jpg/.jpeg/.png-Dateien verlinkt, werden
  diese heruntergeladen und in MinIO gespeichert (Ausnahmefall).
  In der Regel verbleiben Listings ohne Fotos und zeigen den Platzhalter.

Dokument-Logik (Gutachten / amtliche Bekanntmachung):
  Die Detailseite (button=showZvg) verlinkt PDF-Anhänge über
  button=showAnhang&land_abk=..&file_id=..&zvg_id=... . zvg-portal.de prüft
  bei diesen Anhang-Links den Referer-Header: Ein Request ohne Referer oder
  mit falschem Referer liefert den Body "error" (kein PDF!) statt der Datei.
  Verifiziert per direktem Test am 2026-07-03: identische URL liefert mit
  Referer = der Objekt-Detailseite selbst (button=showZvg&zvg_id=..) ein
  gültiges PDF, aber mit fehlendem/falschem Referer nur "error" (5 Bytes).
  Daher wird beim Anhang-Download IMMER Referer=direktlink (die Detailseite
  des jeweiligen Objekts) gesetzt – analog dazu, wie ein Browser beim Klick
  auf den Link vorgehen würde.
  Die beiden Anhänge werden wie folgt auf die vorhandenen ZvgListing-Felder
  gemappt (nur zwei Dokument-Slots im Schema vorgesehen):
    - "Gutachten"            → gutachten_url
    - "amtliche Bekanntmachung" → expose_url (bester verfügbarer Slot für
      ein zweites, textuell auswertbares Dokument; enthält i.d.R. Termin-,
      Gutachten- und Verfahrensangaben, die der KI-Analyse zugutekommen)
  Beide PDFs werden direkt beim Scrapen heruntergeladen und in MinIO
  gespeichert (zuerst {bundesland}/{slug}/…, nach dem Upsert {listing_id}/…),
  damit die spätere KI-Analyse sie ohne erneuten Referer-Trick abrufen kann.
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
from src.utils.adaptive_selector import find_with_adaptive_fallback
from src.utils.bundesland import normalize_bundesland_slug
from src.utils.listing_kategorie import detect_listing_kategorie as _detect_kategorie
from src.utils.listing_flaechen import extract_flaechen_from_text
from src.utils.zvg_identity import listing_identity_key, zvg_listing_slug
from src.utils.page_fetch import fetch_page
from src.utils.url_safety import (
    UrlSafetyError,
    ZVG_PORTAL_HOSTS,
    assert_image_fetch_url,
    assert_zvg_portal_document_url,
    fetch_public_request,
    fetch_public_url,
)
from src.storage.minio import (
    upload_image_bytes_sync,
    upload_document_bytes_sync,
    ensure_bucket,
)

# Der generische Detailseiten-Fetch (GET, liefert HTML zum Parsen) läuft über
# page_fetch.fetch_page(); die folgenden Abrufe nutzen fetch_public_url direkt:
#   - Suche: POST index.php?button=Suchen&all=1 plus ger_name/land_abk/order_by.
#     Das Portal blättert nur per JS-POST (blaettern(), Buttons statt <a href>).
#     GET ?seite=N ohne Formular liefert einen leeren Body (~35 Bytes).
#   - Anhang-PDF-Download (showAnhang) UND direkte Bilddownloads: MUSS die
#     rohen Binärbytes liefern (werden 1:1 in MinIO gespeichert, damit Nutzer
#     das Original-PDF/-Bild abrufen können). fetch_page() liefert nur
#     extrahierten Text/Markdown, keine Rohbytes - dafür fachlich ungeeignet,
#     UNABHÄNGIG vom Referer-Header (der wird korrekt weitergereicht - das ist
#     also NICHT der Grund für den Verbleib bei httpx).
DETAIL_HEADERS = {"Referer": "https://www.zvg-portal.de/"}

BASE_URL = "https://www.zvg-portal.de"
SEARCH_URL = f"{BASE_URL}/index.php?button=Suchen"


def is_portal_detail_url(url: str | None) -> bool:
    if not url:
        return False
    return "button=showZvg" in url and "zvg_id=" in url


DELAY = 2.0
HEADERS = {
    "User-Agent": user_agent(),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "de-DE,de;q=0.9",
    "Referer": BASE_URL + "/",
}

BUNDESLAND_ABK = {
    "hamburg": "hh",
    "berlin": "be",
    "niedersachsen": "ni",
    "nordrhein-westfalen": "nw",
    "bayern": "by",
    "hessen": "he",
    "sachsen": "sn",
    "thueringen": "th",
    "sachsen-anhalt": "st",
    "mecklenburg-vorpommern": "mv",
    "schleswig-holstein": "sh",
    "rheinland-pfalz": "rp",
    "saarland": "sl",
    "bremen": "hb",
    # ACHTUNG: zvg-portal.de verwendet für Brandenburg das Kürzel "br"
    # (nicht "bb" wie man anhand der ISO-3166-2-Konvention DE-BB vermuten
    # würde!). Mit "bb" liefert die Such-POST-Anfrage der Site einen
    # "ERRROR: falsche Parameter übergeben"-Fehler und die tägliche
    # Brandenburg-Suche scheitert seit der letzten (falschen) "Korrektur"
    # komplett (0 Ergebnisse). Verifiziert per direktem curl-Test gegen
    # https://www.zvg-portal.de/index.php?button=Suchen (POST) am 2026-07-03.
    "brandenburg": "br",
    "badenwuerttemberg": "bw",
}

BUNDESLAND_NAMES = {
    "hamburg": "Hamburg",
    "berlin": "Berlin",
    "niedersachsen": "Niedersachsen",
    "nordrhein-westfalen": "Nordrhein-Westfalen",
    "bayern": "Bayern",
    "hessen": "Hessen",
    "sachsen": "Sachsen",
    "thueringen": "Thüringen",
    "sachsen-anhalt": "Sachsen-Anhalt",
    "mecklenburg-vorpommern": "Mecklenburg-Vorpommern",
    "schleswig-holstein": "Schleswig-Holstein",
    "rheinland-pfalz": "Rheinland-Pfalz",
    "saarland": "Saarland",
    "bremen": "Bremen",
    "brandenburg": "Brandenburg",
    "badenwuerttemberg": "Baden-Württemberg",
}


IMAGE_DELAY = 1.0  # Sekunden zwischen Detail- und Anhang-Requests

# Erlaubte echte Bild-Content-Types – PDFs werden explizit NICHT akzeptiert
_REAL_IMAGE_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/webp"}


def _find_anzeige_table(raw_html: str, url: str) -> Optional[BeautifulSoup]:
    """
    table#anzeige ist der EINZIGE Container für alle Detailseiten-Felder
    (Bilder, Gutachten-/Bekanntmachung-Anhänge, Beschreibungstext) - fällt
    diese id bei einem Redesign weg, bricht die komplette
    Detail-Anreicherung stillschweigend weg. Daher über den adaptiven
    Scrapling-Selector gesucht statt direkt per BeautifulSoup (siehe
    adaptive_selector.py).
    """
    return find_with_adaptive_fallback(
        raw_html,
        url,
        field_label="zvg_portal table#anzeige",
        tag_name="table",
        css_selector="table#anzeige",
        storage_file="zvg_portal_selectors.db",
    )


def _collect_direct_image_links(raw_html: str, url: str) -> list[tuple[str, str]]:
    """
    Sucht ausschließlich nach direkt verlinkten Bild-Dateien (.jpg/.jpeg/.png)
    auf der Detailseite. PDFs und andere Anhänge werden ignoriert.
    Gibt Liste von (label, full_href) zurück.
    """
    results: list[tuple[str, str]] = []
    table = _find_anzeige_table(raw_html, url)
    if not table:
        return results

    for row in table.find_all("tr"):
        cells = row.find_all("td")
        if len(cells) < 2:
            continue
        label = cells[0].get_text(strip=True).lower().rstrip(":")
        for a in cells[1].find_all("a", href=True):
            href = a.get("href", "").strip().lower()
            if not any(href.endswith(ext) for ext in (".jpg", ".jpeg", ".png")):
                continue
            href_orig = a.get("href", "").strip()
            if href_orig.startswith("http"):
                full = href_orig
            elif href_orig.startswith("?"):
                full = f"{BASE_URL}/index.php{href_orig}"
            else:
                full = f"{BASE_URL}/{href_orig.lstrip('/')}"
            results.append((label, full))

    return results


# Anhang-Labels → ZvgListing-Feld, auf das die heruntergeladene PDF-URL
# geschrieben wird, sowie MinIO-Dateiname (siehe Modul-Docstring).
_ANHANG_LABEL_MAP: list[tuple[str, str, str]] = [
    # (Substring im Zeilen-Label, ZvgListing-Feldname, MinIO-Dateiname)
    ("bekanntmachung", "expose_url", "expose"),
    ("gutachten", "gutachten_url", "gutachten"),
]

# "Exposee" kennt bisher kein Schema-Feld und wird komplett verworfen. Pragmatischer Fallback
# (Option b aus dem Report): nur verwenden, wenn KEINE "amtliche
# Bekanntmachung" vorhanden ist (die hat Vorrang, siehe _ANHANG_LABEL_MAP
# oben) - bewusst zweite, separate Map + zweite Passe in
# _collect_anhang_links (NICHT einfach in _ANHANG_LABEL_MAP mit aufnehmen),
# damit die Reihenfolge der Zeilen im HTML keine Rolle spielt: stünde
# "Exposee" im Dokument VOR "amtliche Bekanntmachung", würde ein einzelner
# Durchlauf mit "erster Treffer gewinnt" faelschlich dem Exposee Vorrang
# geben. Bekannte, akzeptierte Einschränkung (siehe Abschlussbericht):
# Live-Check am 2026-07-08 über alle 74 aktiven justizportal-Listings zeigt
# 0 Fälle von "Exposee ohne amtliche Bekanntmachung" (bei allen 32
# Exposee-Fällen ist auch eine amtliche Bekanntmachung vorhanden) - dieser
# Fallback greift aktuell also in der Praxis nicht, ist aber die vom
# Auftrag vorgegebene Umsetzung und schadet nicht (siehe Bericht für die
# Empfehlung, stattdessen ein drittes Schema-Feld zu ergänzen).
_ANHANG_FALLBACK_LABEL_MAP: list[tuple[str, str, str]] = [
    ("exposee", "expose_url", "expose"),
]


def _collect_anhang_links(raw_html: str, url: str) -> dict[str, str]:
    """
    Sucht auf der Detailseite (table#anzeige) nach PDF-Anhang-Links
    (button=showAnhang&...), z.B. "Gutachten" und "amtliche Bekanntmachung".
    Gibt ein dict {"gutachten_url": relative_href, "expose_url": relative_href}
    zurück (nur vorhandene Keys). hrefs sind noch relativ (z.B.
    "?button=showAnhang&land_abk=rp&file_id=5827&zvg_id=3876").
    """
    result: dict[str, str] = {}
    table = _find_anzeige_table(raw_html, url)
    if not table:
        return result

    anhang_rows: list[tuple[str, str]] = []
    for row in table.find_all("tr"):
        cells = row.find_all("td")
        if len(cells) < 2:
            continue
        label = cells[0].get_text(" ", strip=True).lower().rstrip(":")
        a = cells[1].find("a", href=True)
        if not a:
            continue
        href = a.get("href", "").strip()
        if "showanhang" not in href.lower():
            continue
        anhang_rows.append((label, href))

    for label, href in anhang_rows:
        for substr, field_name, _minio_name in _ANHANG_LABEL_MAP:
            if substr in label and field_name not in result:
                result[field_name] = href

    # Fallback-Passe (Fix 5): erst NACH der vollständigen ersten Passe über
    # ALLE Zeilen, damit "amtliche Bekanntmachung" unabhängig von ihrer
    # Position im Dokument stets Vorrang vor "Exposee" hat.
    for label, href in anhang_rows:
        for substr, field_name, _minio_name in _ANHANG_FALLBACK_LABEL_MAP:
            if substr in label and field_name not in result:
                result[field_name] = href

    return result


def _extract_beschreibung(raw_html: str, url: str) -> Optional[str]:
    """
    Extrahiert den Freitext der "Beschreibung"-Zeile aus table#anzeige
    (Objektbeschreibung/Lage laut Sachverständigem). Wird als zusätzliche
    Textquelle für die KI-Analyse genutzt, falls kein Gutachten-PDF
    verfügbar/extrahierbar ist.
    """
    table = _find_anzeige_table(raw_html, url)
    if not table:
        return None
    for row in table.find_all("tr"):
        cells = row.find_all("td")
        if len(cells) < 2:
            continue
        label = cells[0].get_text(" ", strip=True).lower().rstrip(":")
        if label == "beschreibung":
            text = cells[1].get_text("\n", strip=True)
            return text or None
    return None


def _extract_amtsgericht(raw_html: str) -> Optional[str]:
    """
    Liest das Amtsgericht aus der Breadcrumb der Detailseite
    ("Sie sind hier: Amtsgericht: Aurich in Niedersachsen").

    Die Ergebnisliste nennt an derselben Stelle nur das Bundesland
    ("Amtsgericht in Niedersachsen"), weshalb _parse_result_page() den Wert
    dort verwirft und 87 Objekte ohne Gericht in der DB standen. Seit
    Migration 0020 ist das Amtsgericht Teil der Objektidentitaet - der Wert
    muss also aus der Detailseite kommen.
    """
    match = re.search(
        r"Amtsgericht:\s*(.+?)\s+in\s+[A-ZÄÖÜ]",
        re.sub(r"<[^>]+>", " ", raw_html),
    )
    if not match:
        return None
    name = re.sub(r"\s+", " ", match.group(1)).strip(" -–,")
    return name or None


async def _download_anhang_pdf(
    client: httpx.AsyncClient,
    anhang_href: str,
    referer: str,
) -> Optional[bytes]:
    """
    Lädt einen showAnhang-PDF-Anhang herunter. zvg-portal.de prüft den
    Referer-Header und liefert ohne korrekten Referer nur den Text "error"
    statt der Datei – daher MUSS referer=die Objekt-Detailseite gesetzt werden.
    """
    href = anhang_href.strip()
    if href.startswith("http"):
        full_url = href
    elif href.startswith("?"):
        full_url = f"{BASE_URL}/index.php{href}"
    else:
        full_url = f"{BASE_URL}/{href.lstrip('/')}"

    try:
        full_url = assert_zvg_portal_document_url(full_url)
    except UrlSafetyError:
        logger.warning(f"Anhang-URL abgelehnt: {full_url}")
        return None

    try:
        await asyncio.sleep(IMAGE_DELAY)
        resp = await fetch_public_url(
            full_url,
            timeout_sec=30.0,
            headers={**HEADERS, "Referer": referer},
            require_https=True,
            allowed_hosts=ZVG_PORTAL_HOSTS,
        )
        resp.raise_for_status()
        content = resp.content
        ct = resp.headers.get("content-type", "").split(";")[0].strip().lower()

        if ct != "application/pdf" and not content.startswith(b"%PDF"):
            # zvg-portal.de liefert bei fehlendem/falschem Referer den
            # 5-Byte-Body "error" statt eines PDFs.
            logger.warning(
                f"Anhang kein PDF (Referer-Check vermutlich fehlgeschlagen): "
                f"{full_url} → content-type={ct}, len={len(content)}"
            )
            return None
        return content
    except Exception as e:
        logger.warning(f"Anhang-Download fehlgeschlagen ({full_url}): {e}")
        return None


async def _download_real_image(
    client: httpx.AsyncClient,
    image_url: str,
    referer: str = BASE_URL,
) -> bytes | None:
    """
    Lädt eine direkt verlinkte Bilddatei herunter.
    Akzeptiert nur echte Bild-Content-Types (JPEG, PNG, WebP) – keine PDFs.
    Gibt JPEG-Bytes zurück oder None.
    """
    safe = assert_image_fetch_url(image_url)
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

        # PDFs und alle anderen Typen werden stillschweigend ignoriert
        logger.debug(f"Übersprungen (kein Bild): {ct} – {image_url}")
        return None

    except Exception as e:
        logger.debug(f"Bild-Download fehlgeschlagen ({image_url}): {e}")
        return None


async def _fetch_detail_html(client: httpx.AsyncClient, direktlink: str) -> Optional[str]:
    """
    Holt das HTML einer Detailseite (button=showZvg). Primärpfad: fetch_page
    (siehe page_fetch.py). Bei Fehler/leerem Ergebnis Fallback auf den
    direkten httpx-Request - NICHT stillschweigend "keine Daten" zurückgeben.
    """
    if not is_portal_detail_url(direktlink):
        logger.warning(f"Detail-URL ist keine Objektseite: {direktlink}")
        return None
    try:
        direktlink = assert_zvg_portal_document_url(direktlink)
    except UrlSafetyError:
        logger.warning(f"Detail-URL abgelehnt: {direktlink}")
        return None

    try:
        result = await fetch_page(
            direktlink,
            headers=DETAIL_HEADERS,
            allowed_hosts=ZVG_PORTAL_HOSTS,
        )
        if result.success and len(result.raw_html) >= 50:
            return result.raw_html
        logger.debug(
            f"fetch_page der Detailseite unzureichend "
            f"(success={result.success}, len={len(result.raw_html)}) – Fallback auf httpx: {direktlink}"
        )
    except Exception as e:
        logger.warning(
            f"fetch_page der Detailseite fehlgeschlagen, Fallback auf httpx ({direktlink}): {e}"
        )

    try:
        resp = await fetch_public_url(
            direktlink,
            timeout_sec=30.0,
            headers=HEADERS,
            require_https=True,
            allowed_hosts=ZVG_PORTAL_HOSTS,
        )
        resp.raise_for_status()
    except Exception as e:
        logger.debug(f"Detailseite auch per httpx-Fallback nicht abrufbar ({direktlink}): {e}")
        return None

    if len(resp.content) < 50:
        logger.debug(f"Detailseite zu kurz ({len(resp.content)} bytes) – {direktlink}")
        return None

    return resp.text


async def _enrich_listing_from_detail(
    client: httpx.AsyncClient,
    direktlink: str,
    bundesland: str,
    slug: str,
    max_images: int = 3,
    upload_binaries: bool = True,
    *,
    aktenzeichen: str | None = None,
    ort: str | None = None,
    amtsgericht: str | None = None,
) -> dict:
    """
    Ruft die Detailseite eines Listings EINMAL ab und reichert es an mit:
      - image_urls: direkt verlinkte echte Bilddateien (.jpg/.jpeg/.png),
        in MinIO hochgeladen (im Regelfall leer für zvg-portal.de)
      - gutachten_url / expose_url: PDF-Anhänge (Gutachten, amtliche
        Bekanntmachung), mit korrektem Referer heruntergeladen und in
        MinIO hochgeladen (siehe Modul-Docstring zum Referer-Schutz)
      - beschreibung: Freitext der "Beschreibung"-Zeile (Fallback-Textquelle
        für die KI-Analyse, falls PDF-Text nicht verfügbar ist)
    Gibt ein dict mit den oben genannten Keys zurück (nur befüllte Keys).
    """
    extra: dict = {}
    if not direktlink:
        return extra

    await asyncio.sleep(IMAGE_DELAY)
    html = await _fetch_detail_html(client, direktlink)
    if html is None:
        return extra

    court = _extract_amtsgericht(html) or amtsgericht
    if court:
        extra["amtsgericht"] = court
    if aktenzeichen:
        slug = zvg_listing_slug(
            aktenzeichen,
            bundesland,
            amtsgericht=court,
            ort=ort,
        )
        extra["slug"] = slug

    # 1. Echte Bilddateien (Ausnahmefall bei zvg-portal.de)
    image_links = _collect_direct_image_links(html, direktlink)
    if upload_binaries and image_links:
        uploaded_urls: list[str] = []
        position = 0
        for label, url in image_links[:max_images]:
            img_bytes = await _download_real_image(client, url, referer=direktlink)
            if not img_bytes:
                continue
            result = upload_image_bytes_sync(
                img_bytes, "image/jpeg", bundesland, slug, position=position
            )
            if result:
                storage_path, public_url = result
                uploaded_urls.append(public_url)
                logger.debug(f"Foto {position} hochgeladen: {storage_path} (Quelle: {label})")
                position += 1
        if uploaded_urls:
            extra["image_urls"] = uploaded_urls
    elif image_links:
        logger.debug(
            f"MinIO nicht erreichbar, {len(image_links)} Bildlink(s) übersprungen: {direktlink}"
        )
    else:
        logger.debug(f"Keine echten Bildlinks auf Detailseite: {direktlink}")

    # 2. PDF-Anhänge (Gutachten, amtliche Bekanntmachung)
    anhang_links = _collect_anhang_links(html, direktlink)
    for field_name, minio_name in (("gutachten_url", "gutachten"), ("expose_url", "expose")):
        href = anhang_links.get(field_name)
        if not href:
            continue
        if not upload_binaries:
            extra[field_name] = href
            continue
        pdf_bytes = await _download_anhang_pdf(client, href, referer=direktlink)
        if not pdf_bytes:
            continue
        result = upload_document_bytes_sync(pdf_bytes, minio_name, bundesland, slug)
        if result:
            _, public_url = result
            extra[field_name] = public_url
            logger.debug(f"{minio_name} hochgeladen: {public_url}")

    # 3. Beschreibungstext (Fallback für KI-Analyse)
    beschreibung = _extract_beschreibung(html, direktlink)
    if beschreibung:
        extra["beschreibung"] = beschreibung
        flaechen = extract_flaechen_from_text(beschreibung)
        if flaechen.get("wohnflaeche_m2"):
            extra["wohnflaeche_m2"] = flaechen["wohnflaeche_m2"]
        if flaechen.get("nutzflaeche_m2"):
            extra["nutzflaeche_m2"] = flaechen["nutzflaeche_m2"]
            extra["gesamtflaeche_m2"] = flaechen["nutzflaeche_m2"]

    return extra


# Ein einzelner, korrekt formatierter deutscher Geldbetrag: Tausenderpunkte
# gefolgt von einem Komma und entweder zwei Nachkommastellen ("114.000,00")
# oder dem in Gerichtsvordrucken üblichen Kurzformat für ",00" ("114.000,-"
# bzw. "114.000,--"). (?!\d) verhindert, dass ein Treffer versehentlich an
# einer Ziffernfolge endet, die eigentlich noch zur Zahl gehört.
_EURO_AMOUNT_RE = re.compile(r"\d{1,3}(?:\.\d{3})*,(?:\d{2}|-{1,2})(?!\d)")

# Manche Zellen nennen explizit einen "Gesamtwert"/"Gesamtverkehrswert" für
# mehrere Teilobjekte (z.B. "... lfd.Nr. 1: 64.000,00 € Gesamtwert:
# 544.000,00 €"), der - wenn vorhanden - IMMER der maßgebliche Gesamtwert
# des Objekts ist (per Live-Check bestätigt, siehe _parse_euro-Docstring).
# Hat Vorrang vor dem sonst verwendeten ersten Einzelbetrag.
_GESAMT_AMOUNT_RE = re.compile(r"[Gg]esamt\w*\s*[:\-]?\s*(" + _EURO_AMOUNT_RE.pattern + r")")


def _parse_euro(text: str) -> Optional[int]:
    """250.000,00 € → 250000.

    Die Verkehrswert-Zelle enthält bei vielen Listings mehr als nur den
    Hauptwert - Zubehör-Aufschlüsselungen ("davon entfällt auf Zubehör:
    350,00 € …") oder Teilobjekt-Aufzählungen ("Lfd. Nr. 1 - 114.000,-- Euro
    Lfd. Nr. 2 - 3.700,-- Euro"). Die alte Logik (Text vor dem ersten Komma
    behalten, dann ALLE verbleibenden Ziffern zusammenkleben) pickte dabei
    Ziffern aus Nummerierungen/Nebenwerten mit auf (Beispiel
    "Lfd. Nr. 1 - 114.000,-- Euro" wurde zu 1114000 statt 114000).
    Deshalb: striktes Regex-Muster für einen einzelnen, korrekt formatierten
    Betrag (_EURO_AMOUNT_RE) verwenden. Reihenfolge (per Live-Verifikation
    an mehreren Aktenzeichen bestätigt):
      1. Ein explizit genannter Gesamt(verkehrs)wert (_GESAMT_AMOUNT_RE) ist
         IMMER maßgeblich, unabhängig davon, wo er in der Zelle steht.
      2. Sonst der ERSTE Einzelbetrag - in allen bisher bekannten
         Zellenformaten ohne "Gesamt"-Angabe steht der Haupt-/Einzelwert vor
         einer etwaigen Zubehör-/Teilobjekt-Aufschlüsselung.
    Bekannte Einschränkung: nennt die Quelle mehrere Teilobjekt-Werte OHNE
    einen expliziten Gesamtwert (z.B. mehrere Flurstücke eines gemeinsam
    versteigerten Grundstücks), liefert dieser Fix nur den ersten
    Teilobjekt-Wert, nicht die (von der Quelle nicht explizit gebildete)
    Summe.

    Datenqualitäts-Policy-Änderung (2026-07-04, siehe scrapers/src/utils/data_quality.py):
    Werte außerhalb [1.000, 50.000.000] € wurden hier bisher komplett VERWORFEN
    (auf None gesetzt) statt nur markiert - das widerspricht dem neuen Prinzip
    "auffällige Werte sichtbar flaggen statt still verwerfen" (echte, aber
    unübliche Verkehrswerte, z.B. symbolische 1-€-Übernahmen oder sehr hochwertige
    Gewerbeobjekte, wären damit fälschlich komplett verschwunden). Die
    Bereichsprüfung läuft jetzt NACHGELAGERT und einheitlich für alle drei
    Quellen über die zentrale data_quality-Engine (check_verkehrswert()), die
    den Wert als `needs_review` flaggt statt ihn zu löschen.
    """
    if not text:
        return None
    gesamt_match = _GESAMT_AMOUNT_RE.search(text)
    betrag = gesamt_match.group(1) if gesamt_match else None
    if betrag is None:
        einzel_match = _EURO_AMOUNT_RE.search(text)
        if not einzel_match:
            return None
        betrag = einzel_match.group(0)
    ganzzahl_teil = betrag.split(",")[0]  # "114.000,00"/"114.000,-" → "114.000"
    digits = ganzzahl_teil.replace(".", "")
    if not digits:
        return None
    return int(digits)


_BERLIN = ZoneInfo("Europe/Berlin")


def _parse_date(text: str) -> Optional[datetime]:
    if not text:
        return None
    # "Mittwoch, 24. Juni 2026, 08:15 Uhr" → datetime (CEST/CET aware)
    MONATE = {
        "Januar": 1,
        "Februar": 2,
        "März": 3,
        "April": 4,
        "Mai": 5,
        "Juni": 6,
        "Juli": 7,
        "August": 8,
        "September": 9,
        "Oktober": 10,
        "November": 11,
        "Dezember": 12,
    }
    m = re.search(r"(\d{1,2})\.\s+(\w+)\s+(\d{4}),?\s*(\d{1,2}):(\d{2})", text)
    if m:
        try:
            tag, mon_name, jahr, std, min_ = m.groups()
            monat = MONATE.get(mon_name)
            if monat:
                return datetime(int(jahr), monat, int(tag), int(std), int(min_), tzinfo=_BERLIN)
        except Exception:
            pass
    for fmt in ["%d.%m.%Y %H:%M", "%d.%m.%Y"]:
        try:
            return datetime.strptime(text.strip(), fmt).replace(tzinfo=_BERLIN)
        except ValueError:
            pass
    return None


def _split_objekt_lage(adresse_raw: str) -> tuple[Optional[str], str]:
    raw = (adresse_raw or "").strip()
    if not raw:
        return None, ""
    if "," not in raw:
        return raw, raw

    street_and_plz = re.match(r"^(.+?),\s*(.+\s\d{5}\b.*)$", raw)
    if street_and_plz:
        typ = street_and_plz.group(1).strip()
        return typ or None, street_and_plz.group(2).strip()

    plz_only = re.match(r"^(.+?),\s*(\d{5}\b.*)$", raw)
    if plz_only:
        typ = plz_only.group(1).strip()
        return typ or None, plz_only.group(2).strip()

    house_no = re.match(r"^(.+?),\s*(\d+\s+\S+.*)$", raw)
    if house_no:
        typ = house_no.group(1).strip()
        return typ or None, house_no.group(2).strip()

    return None, raw


def _parse_adresse(adresse_text: str) -> dict:
    """Extrahiert PLZ, Ort und ggf. Straße aus Adresstext."""
    result = {"adresse": adresse_text, "plz": None, "ort": None, "strasse": None}
    m = re.search(r"(\d{5})\s+([\w\s\-äöüÄÖÜß]+)", adresse_text)
    if m:
        result["plz"] = m.group(1)
        result["ort"] = m.group(2).strip()
    lines = [l.strip() for l in adresse_text.split(",") if l.strip()]
    if len(lines) > 1:
        result["strasse"] = lines[0]
    return result


def _parse_objekte_from_soup(
    soup: BeautifulSoup, bundesland: str, bl_name: str, abk: str
) -> list[ZvgListing]:
    """
    Parst alle Objekte aus der Ergebnisseite.
    Jedes Objekt besteht aus zusammenhängenden <tr>-Zeilen:
      Row: ['Aktenzeichen', '<AZ> (Detailansicht)']  ← Link zu Detail
      Row: ['Amtsgericht', '<Ort>']
      Row: ['Objekt/Lage', '<Typ und Adresse>']
      Row: ['Verkehrswert in €', '<Betrag>']
      Row: ['Termin', '<Datum>']
    """
    listings: list[ZvgListing] = []
    rows = soup.select("table tr")

    current: dict = {}
    seen_ids: set[tuple[str, str, str]] = set()

    def flush(data: dict):
        az = data.get("aktenzeichen")
        if not az:
            return
        identity = listing_identity_key(bundesland, data.get("amtsgericht"), az)
        if identity[1] and identity in seen_ids:
            return
        if identity[1]:
            seen_ids.add(identity)

        adresse_raw = data.get("objekt_lage", "")
        typ, adresse = _split_objekt_lage(adresse_raw)

        addr = _parse_adresse(adresse)

        # Qualitätsfilter: Listing ohne Adresse UND ohne Ort überspringen
        hat_adresse = bool(adresse and adresse.strip())
        hat_ort = bool(addr.get("ort"))
        if not hat_adresse and not hat_ort:
            logger.warning(
                f"Qualitätsfilter: {az} übersprungen – keine Adresse und kein Ort "
                f"(objekt_lage={adresse_raw!r})"
            )
            return

        # Warnung bei generischem Typ ohne weitere Informationen
        if typ and typ.strip().lower() in ("immobilie", "grundstück", "objekt") and not hat_adresse:
            logger.warning(f"Qualitätsfilter: {az} hat generischen Typ {typ!r} und keine Adresse")

        slug = zvg_listing_slug(
            az,
            bundesland,
            amtsgericht=data.get("amtsgericht"),
            ort=addr.get("ort") or abk,
        )

        zvg_id = data.get("zvg_id")
        raw = {"zvg_id": zvg_id, "land_abk": abk} if zvg_id else {"land_abk": abk}

        parsed_link = data.get("direktlink")
        direktlink = parsed_link if is_portal_detail_url(parsed_link) else None
        source_url = direktlink or (f"{BASE_URL}/index.php?button=Termine+suchen&land_abk={abk}")

        listings.append(
            ZvgListing(
                aktenzeichen=az,
                # Normalisierung als Sicherheitsnetz (siehe src/utils/bundesland.py):
                # `bundesland` ist hier bereits der kanonische Slug aus
                # BUNDESLAND_ABK, ein expliziter normalize-Call schützt aber vor
                # künftigem Auseinanderdriften, falls dieser Aufrufparameter
                # jemals direkt aus Rohdaten gefüllt wird.
                bundesland=normalize_bundesland_slug(bundesland),
                bundesland_name=bl_name,
                slug=slug,
                source="justizportal",
                source_url=source_url,
                direktlink=direktlink,
                typ=typ,
                kategorie=_detect_kategorie(typ or ""),
                adresse=adresse or adresse_raw,
                plz=addr.get("plz"),
                ort=addr.get("ort"),
                strasse=addr.get("strasse"),
                amtsgericht=data.get("amtsgericht"),
                verkehrswert=_parse_euro(data.get("verkehrswert", "")),
                termin_date=_parse_date(data.get("termin", "")),
                ist_neu=True,
                raw_data=raw,
            )
        )

    for row in rows:
        cells = row.find_all("td")
        if len(cells) < 2:
            continue

        key = cells[0].get_text(" ", strip=True).lower().strip(": ")
        val = cells[1].get_text(" ", strip=True)
        link = cells[1].find("a", href=True)

        if "aktenzeichen" in key:
            if current:
                flush(current)
            current = {}
            # AZ bereinigen: "0021 K 0024/2025 (Detailansicht)" → "0021 K 0024/2025"
            az = re.sub(r"\s*\(.*?\)", "", val).strip()
            current["aktenzeichen"] = az
            if link:
                href = link.get("href", "")
                # zvg_id aus dem Link extrahieren und Direktlink sauber konstruieren
                zvg_id_match = re.search(r"zvg_id=(\d+)", href)
                if zvg_id_match:
                    zvg_id = zvg_id_match.group(1)
                    current["zvg_id"] = zvg_id
                    current["direktlink"] = (
                        f"{BASE_URL}/index.php?button=showZvg&zvg_id={zvg_id}&land_abk={abk}"
                    )
                else:
                    current["direktlink"] = (
                        href if href.startswith("http") else f"{BASE_URL}/{href.lstrip('/')}"
                    )
        elif "amtsgericht" in key:
            cleaned = re.sub(r"^\s*in\s+", "", val.strip())
            if not cleaned or cleaned in set(BUNDESLAND_NAMES.values()):
                cleaned = None
            current["amtsgericht"] = cleaned
        elif "objekt" in key or "lage" in key:
            current["objekt_lage"] = val
        elif "verkehrswert" in key:
            current["verkehrswert"] = val
        elif "termin" in key and "aktenzeichen" not in key:
            current["termin"] = val

    if current:
        flush(current)

    return listings


async def scrape_bundesland(
    bundesland: str,
    max_pages: int = 50,
    fetch_images: bool = True,
) -> list[ZvgListing]:
    """
    Scrapt alle ZVG-Listings für ein Bundesland vom Justizportal.

    fetch_images=True (Name historisch bedingt) startet die Detailseiten-
    Anreicherung pro Listing. Ein MinIO-Ausfall überspringt nur Uploads,
    nicht Beschreibung, Amtsgericht und Anhang-URLs:
      - echte Bilddateien (.jpg/.jpeg/.png) – im Regelfall leer, da
        zvg-portal.de fast ausschließlich PDFs verlinkt
      - Gutachten-/amtliche-Bekanntmachung-PDFs (Referer-geschützt, siehe
        Modul-Docstring), bei erreichbarem MinIO hochgeladen
      - Beschreibungstext als Fallback-Textquelle für die KI-Analyse
    """
    abk = BUNDESLAND_ABK.get(bundesland)
    if not abk:
        logger.warning(f"Unbekanntes Bundesland: {bundesland}")
        return []

    bl_name = BUNDESLAND_NAMES.get(bundesland, bundesland.title())
    all_listings: list[ZvgListing] = []
    seen_ids: set[tuple[str, str, str]] = set()

    upload_binaries = fetch_images
    if fetch_images:
        try:
            ensure_bucket()
        except Exception as e:
            logger.warning(f"MinIO-Bucket-Fehler (Uploads werden übersprungen): {e}")
            upload_binaries = False

    cookies = httpx.Cookies()
    async with httpx.AsyncClient(headers=HEADERS, follow_redirects=False, timeout=90) as client:
        try:
            await asyncio.sleep(DELAY)
            resp = await fetch_public_request(
                "POST",
                f"{SEARCH_URL}&all=1",
                data={"ger_name": "", "land_abk": abk, "order_by": "2"},
                timeout_sec=90.0,
                headers=HEADERS,
                allowed_hosts=ZVG_PORTAL_HOSTS,
                cookies=cookies,
            )
            resp.raise_for_status()
        except (httpx.HTTPError, UrlSafetyError) as e:
            logger.warning(f"HTTP-Fehler Suche {bundesland}: {e}")
            return []

        soup = BeautifulSoup(resp.text, "html.parser")
        m = re.search(r"Insgesamt\s+(\d+)", soup.get_text())
        logger.info(f"{bundesland}: {m.group(1) if m else '?'} Gesamtergebnisse")

        page_listings = _parse_objekte_from_soup(soup, bundesland, bl_name, abk)

        for listing in page_listings:
            known = listing_identity_key(
                listing.bundesland, listing.amtsgericht, listing.aktenzeichen
            )
            if known[1] and known in seen_ids:
                continue
            extra = None
            if fetch_images and is_portal_detail_url(listing.direktlink):
                extra = await _enrich_listing_from_detail(
                    client,
                    listing.direktlink,
                    bundesland,
                    listing.slug,
                    upload_binaries=upload_binaries,
                    aktenzeichen=listing.aktenzeichen,
                    ort=listing.ort or abk,
                    amtsgericht=listing.amtsgericht,
                )
                if extra:
                    listing = listing.model_copy(update=extra)
                    if extra.get("image_urls"):
                        logger.debug(
                            f"{listing.aktenzeichen}: "
                            f"{len(extra['image_urls'])} Foto(s) hochgeladen"
                        )
                    if extra.get("gutachten_url") or extra.get("expose_url"):
                        logger.info(
                            f"{listing.aktenzeichen}: Dokumente hochgeladen "
                            f"(gutachten={'ja' if extra.get('gutachten_url') else 'nein'}, "
                            f"bekanntmachung={'ja' if extra.get('expose_url') else 'nein'})"
                        )
            if fetch_images:
                listing = listing.model_copy(update={"detail_scrape_complete": True})
            identity = listing_identity_key(
                listing.bundesland, listing.amtsgericht, listing.aktenzeichen
            )
            if identity in seen_ids:
                continue
            seen_ids.add(identity)
            all_listings.append(listing)

        logger.info(
            f"{bundesland}: {len(all_listings)} Listings "
            f"| {sum(1 for l in all_listings if l.image_urls)} mit Fotos"
        )

    photos_total = sum(1 for l in all_listings if l.image_urls)
    gutachten_total = sum(1 for l in all_listings if l.gutachten_url)
    expose_total = sum(1 for l in all_listings if l.expose_url)
    logger.info(
        f"Fertig: {bundesland} – {len(all_listings)} Listings, "
        f"{photos_total} mit Fotos, {gutachten_total} mit Gutachten, "
        f"{expose_total} mit amtl. Bekanntmachung"
    )
    return all_listings
