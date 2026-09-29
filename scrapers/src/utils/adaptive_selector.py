"""
Adaptive-Selector-Fallback für BeautifulSoup-basierte ZVG-Parser (Scrapling-
Ausbau Phase 3, siehe docs/CUSTOM_URL_ANALYSIS.md).

BeautifulSoup bleibt der primäre Parser für zvg_portal.py/hanmark.py (siehe
Epic: "kein Big-Bang" - keine Komplett-Umstellung auf Scrapling-Selectors).
Für die kritischsten Einzelpunkte - jene Selektoren, deren Ausfall die
GESAMTE Detail-/Listing-Anreicherung einer Quelle stoppt - läuft die Suche
stattdessen über EINEN Scrapling-`Selector.css(adaptive=True, auto_save=True)`-
Aufruf: Scrapling versucht zuerst den normalen CSS-Treffer, fällt bei einem
Fehltreffer automatisch auf die zuletzt gespeicherte Element-Position zurück
(z.B. nach einem Redesign mit geänderter id/class) und speichert bei jedem
Erfolg die aktuelle Position für künftige Wiederfindung.

WICHTIG: Ein reiner "BS4 zuerst, Scrapling nur im Fehlerfall" TÊ Ansatz
funktioniert NICHT - Scrapling kann nur dann eine Position "wiederfinden",
wenn sie bei einem FRÜHEREN erfolgreichen Lauf bereits über Scrapling
gespeichert wurde. Deshalb läuft hier IMMER der Scrapling-Call (der intern
selbst zuerst den normalen, schnellen Pfad versucht).

Schlägt auch der adaptive Fallback fehl, wird SELECTOR_DRIFT geloggt (statt
stillem Leerlauf) - macht ein Redesign beim betroffenen Portal sofort
sichtbar statt es als "0 Ergebnisse"/fehlende Felder untergehen zu lassen.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from bs4 import BeautifulSoup, Tag
from loguru import logger
from scrapling.parser import Selector

from src.utils.url_safety import log_safe_url

ADAPTIVE_STORAGE_DIR = os.environ.get("SCRAPLING_ADAPTIVE_STORAGE_DIR", "/data/scrapling")


def find_with_adaptive_fallback(
    raw_html: str,
    url: str,
    *,
    field_label: str,
    tag_name: str,
    css_selector: str,
    storage_file: str,
) -> Optional[Tag]:
    """
    `css_selector` wird über Scrapling mit `adaptive=True, auto_save=True`
    gesucht (normaler Treffer ODER Wiederfindung anhand der zuletzt
    gespeicherten Position). Das Ergebnis wird als BeautifulSoup-`Tag`
    zurückgegeben, damit der Aufrufer unverändert mit der bestehenden
    BS4-Zellen-/Zeilen-Parsing-Logik weiterarbeiten kann.
    """
    try:
        storage_path = f"{ADAPTIVE_STORAGE_DIR}/{storage_file}"
        Path(storage_path).parent.mkdir(parents=True, exist_ok=True)
        selector = Selector(
            content=raw_html,
            url=url,
            adaptive=True,
            storage_args={"storage_file": storage_path, "url": url},
        )
        matches = selector.css(css_selector, auto_save=True, adaptive=True)
    except Exception as e:
        logger.error(
            f"SELECTOR_DRIFT: {field_label} - Selector-Abfrage fehlgeschlagen ({log_safe_url(url)}): {e}"
        )
        return None

    if not matches:
        logger.error(
            f"SELECTOR_DRIFT: {field_label} nicht gefunden (auch adaptiv nicht) - {log_safe_url(url)}"
        )
        return None

    return BeautifulSoup(str(matches[0].html_content), "html.parser").find(tag_name)
