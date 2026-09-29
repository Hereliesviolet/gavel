"""
Gezielte DOM-Extraktion vor dem LLM-Call (Scrapling-Ausbau Phase 2, siehe
docs/CUSTOM_URL_ANALYSIS.md) - reduziert die Zeichenmenge, die
`_extract_listing_data()` (src/api/app.py) an den LLM-Call übergibt, indem
NUR die für die Extraktion relevanten DOM-Abschnitte herausgeschnitten
werden statt der vollen Markdown-Konvertierung der Seite (bis zu 40.000
Zeichen).

Reihenfolge pro Aufruf: Domain-Profil (bekannte, verifizierte CSS-Selektoren
je Portal) → generische Heuristik (unbekannte Domains) → optionaler
JSON-LD-Versuch wird IMMER zusätzlich angehängt, wenn er plausible
Preis-/Angebotsdaten enthält (kostet nichts, greift aber selten - siehe
Empirik unten). Bei zu wenig extrahiertem Text (`success=False`) bleibt
`run_custom_url_analysis()` unverändert beim vollen Markdown - kein
Qualitätsverlust im Worst Case.

Domain-Profile: NUR kleinanzeigen.de ist aktuell gegen echte Live-Listings
verifiziert (siehe Selektoren unten). Für alle anderen Domains greift bewusst
NUR die generische Heuristik statt unverifizierter, potenziell falscher
Domain-Selektoren.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from bs4 import BeautifulSoup
from loguru import logger
from scrapling.parser import Selector

from src.utils.content_price import preiszeile_aus_text
from src.utils.scrape_domains import normalize_domain
from src.utils.url_safety import log_safe_url

MAX_SLICE_CHARS = 8000
MIN_SLICE_CHARS_FOR_SUCCESS = 500

ADAPTIVE_STORAGE_FILE = (
    os.environ.get("SCRAPLING_ADAPTIVE_STORAGE_DIR", "/data/scrapling") + "/content_slicer.db"
)

SliceSource = Literal["domain_profile", "heuristic", "json_ld", "fallback"]

# (Label, CSS-Selektor, mehrere Treffer sammeln statt nur den ersten).
# kleinanzeigen.de gegen ein echtes Live-Listing verifiziert (2026-07-21):
# "#viewad-description-text" selbst ist wegen ungültig verschachteltem HTML
# (<div>/<h1> in einem <p>) nach lxml-Parsing LEER - der eigentliche Text
# landet als direkt folgendes Sibling-<div> im DOM, daher "+ div".
_KLEINANZEIGEN_PROFILE: list[tuple[str, str, bool]] = [
    ("Titel", "h1", False),
    ("Preis", "#viewad-price", False),
    ("Details", ".addetailslist--detail", True),
    ("Beschreibung", "#viewad-description-text + div", False),
]

DOMAIN_PROFILES: dict[str, list[tuple[str, str, bool]]] = {
    "kleinanzeigen.de": _KLEINANZEIGEN_PROFILE,
}


@dataclass
class SlicedContent:
    text: str
    char_count: int
    source: SliceSource
    json_ld_used: bool
    success: bool


def _slice_via_domain_profile(
    raw_html: str, url: str, profile: list[tuple[str, str, bool]]
) -> str | None:
    try:
        Path(ADAPTIVE_STORAGE_FILE).parent.mkdir(parents=True, exist_ok=True)
        selector = Selector(
            content=raw_html,
            url=url,
            adaptive=True,
            storage_args={"storage_file": ADAPTIVE_STORAGE_FILE, "url": url},
        )
    except Exception as e:
        logger.warning(f"content_slicer: Selector-Aufbau fehlgeschlagen ({log_safe_url(url)}): {e}")
        return None

    parts: list[str] = []
    for label, css, multi in profile:
        try:
            matches = selector.css(css, auto_save=True)
        except Exception as e:
            logger.debug(
                f"content_slicer: Selektor '{css}' fehlgeschlagen ({log_safe_url(url)}): {e}"
            )
            continue
        if not matches:
            continue
        if multi:
            texts = [m.get_all_text(separator=" ", strip=True) for m in matches]
            texts = [t for t in texts if t]
            if texts:
                parts.append(f"{label}: " + "; ".join(texts))
        else:
            value = matches[0].get_all_text(separator=" ", strip=True)
            if value:
                parts.append(f"{label}: {value}")

    return "\n".join(parts) if parts else None


def _generic_heuristic(soup: BeautifulSoup) -> str | None:
    parts: list[str] = []

    h1 = soup.find("h1")
    if h1:
        titel = h1.get_text(" ", strip=True)
        if titel:
            parts.append(f"Titel: {titel}")

    for tag in soup.find_all(["span", "div", "strong", "b", "p"]):
        text = tag.get_text(" ", strip=True)
        if not text or len(text) > 60:
            continue
        zeile = preiszeile_aus_text(text, nur_beschriftet=False)
        if zeile:
            parts.append(zeile)
            break

    dl = soup.find("dl")
    if dl:
        text = dl.get_text(" ", strip=True)
        if text:
            parts.append(f"Details: {text[:2000]}")

    table = soup.find("table")
    if table:
        text = table.get_text(" ", strip=True)
        if text:
            parts.append(f"Tabelle: {text[:2000]}")

    paragraphs = [p.get_text(" ", strip=True) for p in soup.find_all("p")]
    paragraphs = [p for p in paragraphs if len(p) > 40]
    if paragraphs:
        longest = max(paragraphs, key=len)
        parts.append(f"Beschreibung: {longest[:4000]}")

    return "\n".join(parts) if parts else None


_JSON_LD_SKIP_TYPES = frozenset(
    {
        "imageobject",
        "website",
        "webpage",
        "breadcrumblist",
        "organization",
        "person",
        "searchaction",
    }
)
_JSON_LD_LISTING_TYPES = frozenset(
    {
        "realestatelisting",
        "apartment",
        "house",
        "singlefamilyresidence",
        "residence",
        "accommodation",
        "product",
        "offer",
        "place",
        "sellaction",
    }
)
_JSON_LD_RENT_TYPES = frozenset({"rentaction"})
_JSON_LD_ADDON_NAME = re.compile(
    r"^(?:stellplatz|tiefgarage|garage|hausgeld|kaution|nebenkosten|betriebskosten)\b",
    re.I,
)


def _json_ld_items(data: Any) -> list[dict[str, Any]]:
    roots = data if isinstance(data, list) else [data]
    items: list[dict[str, Any]] = []
    for root in roots:
        if not isinstance(root, dict):
            continue
        graph = root.get("@graph")
        if isinstance(graph, list):
            items.extend(node for node in graph if isinstance(node, dict))
        items.append(root)
    return items


def _json_ld_types(item: dict[str, Any]) -> set[str]:
    raw = item.get("@type")
    if isinstance(raw, list):
        values = raw
    elif raw is None:
        values = []
    else:
        values = [raw]
    return {str(value).strip().lower() for value in values if value}


def _json_ld_offers(item: dict[str, Any]) -> dict[str, Any] | None:
    offers = item.get("offers")
    if isinstance(offers, list) and offers and isinstance(offers[0], dict):
        return offers[0]
    if isinstance(offers, dict):
        return offers
    return None


def _json_ld_unit_text(offers: dict[str, Any] | None, item: dict[str, Any]) -> str:
    return " ".join(
        str(v)
        for v in (
            (offers or {}).get("unitText"),
            (offers or {}).get("unitCode"),
            item.get("unitText"),
            item.get("unitCode"),
        )
        if v
    )


def _json_ld_is_yearly(offers: dict[str, Any] | None, item: dict[str, Any]) -> bool:
    return bool(
        re.search(r"year|ann\b|jahr|/a\b|p\.?\s*a\.?", _json_ld_unit_text(offers, item), re.I)
    )


def _json_ld_is_monthly(offers: dict[str, Any] | None, item: dict[str, Any]) -> bool:
    return bool(re.search(r"month|monat|\bmon\b", _json_ld_unit_text(offers, item), re.I))


def _json_ld_is_rent(
    types: set[str],
    offers: dict[str, Any] | None,
    item: dict[str, Any],
) -> bool:
    if types & _JSON_LD_RENT_TYPES:
        return True
    business = str((offers or {}).get("businessFunction") or item.get("businessFunction") or "")
    if re.search(r"leaseout|lease-out|miete", business, re.I):
        return True
    return _json_ld_is_monthly(offers, item)


def _json_ld_currency(offers: dict[str, Any] | None, item: dict[str, Any]) -> str | None:
    raw = (offers or {}).get("priceCurrency") or item.get("priceCurrency")
    if raw is None:
        return None
    return str(raw).strip().upper()


def _json_ld_price_snippet(soup: BeautifulSoup) -> str | None:
    """Nur übernehmen, wenn ein JSON-LD-Block plausibel `price`/`offers`
    enthält - kein Automatismus über alle Blöcke, da z.B. kleinanzeigen.de
    30+ JSON-LD-Blöcke ohne Preis (reine Bild-/WebSite-Metadaten) einstreut
    (siehe Modul-Docstring der Epic-Recherche). CHF, Jahresmiete und
    Stellplatz-/Nebenkosten-Offers werden nicht als Angebotspreis übernommen.
    `@graph`-Hüllen (schema.org) werden aufgelöst."""
    best: tuple[int, str] | None = None
    for script in soup.find_all("script", type="application/ld+json"):
        raw = script.string or script.get_text()
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            continue

        for item in _json_ld_items(data):
            types = _json_ld_types(item)
            if types and types <= _JSON_LD_SKIP_TYPES:
                continue
            offers = _json_ld_offers(item)
            price: Any = offers.get("price") if offers else None
            price = price or item.get("price")
            if not price:
                continue
            currency = _json_ld_currency(offers, item)
            if currency and currency not in ("EUR", "EURO"):
                continue
            if _json_ld_is_yearly(offers, item):
                continue
            name = item.get("name") or item.get("headline")
            if name and _JSON_LD_ADDON_NAME.search(str(name).strip()):
                continue

            is_rent = _json_ld_is_rent(types, offers, item)
            snippet_parts = []
            if name:
                snippet_parts.append(f"Titel: {name}")
            snippet_parts.append(f"{'Kaltmiete' if is_rent else 'Preis'}: {price} EUR")
            description = item.get("description")
            if description:
                snippet_parts.append(f"Beschreibung: {description}")
            snippet = "\n".join(snippet_parts)
            if is_rent:
                score = 0
            else:
                score = 2 if types & _JSON_LD_LISTING_TYPES else 1
            if best is None or score > best[0]:
                best = (score, snippet)
    return best[1] if best else None


def slice_listing_content(raw_html: str, url: str) -> SlicedContent:
    if not raw_html:
        return SlicedContent(
            text="", char_count=0, source="fallback", json_ld_used=False, success=False
        )

    soup = BeautifulSoup(raw_html, "html.parser")
    domain = normalize_domain(url)

    text: str | None = None
    source: SliceSource = "fallback"

    profile = DOMAIN_PROFILES.get(domain)
    if profile:
        text = _slice_via_domain_profile(raw_html, url, profile)
        if text:
            source = "domain_profile"

    if not text:
        text = _generic_heuristic(soup)
        if text:
            source = "heuristic"

    json_ld_text = _json_ld_price_snippet(soup)
    json_ld_used = json_ld_text is not None
    if json_ld_text:
        text = f"{text}\n{json_ld_text}" if text else json_ld_text
        if source == "fallback":
            source = "json_ld"

    text = (text or "")[:MAX_SLICE_CHARS]
    char_count = len(text)
    return SlicedContent(
        text=text,
        char_count=char_count,
        source=source,
        json_ld_used=json_ld_used,
        success=char_count >= MIN_SLICE_CHARS_FOR_SUCCESS,
    )
