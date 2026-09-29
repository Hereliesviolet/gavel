"""
Zentrale Bundesland-Normalisierung für alle Scraper (Fix 2026-07-04).

Python-Äquivalent von apps/web/lib/bundesland.ts - MUSS inhaltlich identisch
bleiben (gleiche kanonische Slugs, gleiche Alias-Liste), sonst driften
Web-Frontend und Scraper wieder auseinander (das war die Ursache des
"Baden-Württemberg unsichtbar"-Bugs: zvg.com lieferte den Bundeslandnamen
"Baden-Württemberg" inkl. Bindestrich, der generische `_slugify()`-Helper in
zvg_com.py wandelte das 1:1 in den Slug "baden-wuerttemberg" um, während
Web-App/andere Scraper konsequent "badenwuerttemberg" ohne Bindestrich
verwenden - beide Schreibweisen landeten unbemerkt in derselben Spalte).

Kanonische Slug-Form = exakt BUNDESLAENDER[].slug aus lib/utils.ts (Web-App).
Bewusst NICHT einheitlich "mit"/"ohne Bindestrich", sondern das, was aktuell
live als URL-Pfad verwendet wird - vermeidet eine SEO-relevante
URL-Migration für 15 von 16 Bundesländern.
"""

import re
import unicodedata

# Kanonische Slugs, 1:1 aus apps/web/lib/utils.ts (BUNDESLAENDER) übernommen.
CANONICAL_BUNDESLAND_SLUGS: list[str] = [
    "hamburg",
    "berlin",
    "niedersachsen",
    "nordrhein-westfalen",
    "bayern",
    "hessen",
    "sachsen",
    "thueringen",
    "sachsen-anhalt",
    "mecklenburg-vorpommern",
    "schleswig-holstein",
    "rheinland-pfalz",
    "saarland",
    "bremen",
    "brandenburg",
    "badenwuerttemberg",
]

# Deutsche Anzeigenamen je kanonischem Slug (für die Vergleichsschlüssel-Ableitung).
_CANONICAL_NAMES: dict[str, str] = {
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

# Bekannte Rohdaten-Varianten, bei denen eine Quelle (insb. zvg.com als
# Amtsgericht-Fallback statt Bundesland) einen Orts-/Amtsgerichtssitznamen
# statt des Bundeslandes geliefert hat. Key = normalisierter Rohwert
# (siehe _to_comparable_key), Value = kanonischer Slug.
_KNOWN_ALIAS_KEY_TO_SLUG: dict[str, str] = {
    "gotha": "thueringen",
    "ludwigshafenamrhein": "rheinland-pfalz",
}

_UMLAUT_MAP = {"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss"}


def _to_comparable_key(raw: str) -> str:
    """Lowercase + Umlaute ausschreiben + alles außer a-z0-9 entfernen."""
    text = unicodedata.normalize("NFC", raw).strip().lower()
    for umlaut, replacement in _UMLAUT_MAP.items():
        text = text.replace(umlaut, replacement)
    return re.sub(r"[^a-z0-9]+", "", text)


def _build_key_to_slug() -> dict[str, str]:
    mapping: dict[str, str] = {}
    for slug in CANONICAL_BUNDESLAND_SLUGS:
        mapping[_to_comparable_key(slug)] = slug
        mapping[_to_comparable_key(_CANONICAL_NAMES[slug])] = slug
    return mapping


_KEY_TO_CANONICAL_SLUG = _build_key_to_slug()


def normalize_bundesland_slug(raw: str | None) -> str:
    """
    Bildet einen beliebigen Bundesland-Rohwert (API-Name, HTML-Text, ...) auf
    die kanonische Slug-Schreibweise ab. Robust gegenüber Bindestrichen,
    Leerzeichen, Groß-/Kleinschreibung und ausgeschriebenen Umlauten.
    Unbekannte Werte werden best-effort normalisiert zurückgegeben (nicht
    verworfen), damit neue/unerwartete Bundesländer nicht stillschweigend
    verschluckt werden - sie sollten dann aber zeitnah in
    _KNOWN_ALIAS_KEY_TO_SLUG bzw. CANONICAL_BUNDESLAND_SLUGS ergänzt werden.
    """
    if not raw:
        return ""
    key = _to_comparable_key(raw)
    if key in _KNOWN_ALIAS_KEY_TO_SLUG:
        return _KNOWN_ALIAS_KEY_TO_SLUG[key]
    if key in _KEY_TO_CANONICAL_SLUG:
        return _KEY_TO_CANONICAL_SLUG[key]
    return key


def canonical_bundesland_name(slug: str) -> str:
    """Kanonischer deutscher Anzeigename für einen kanonischen Slug."""
    return _CANONICAL_NAMES.get(slug, slug.title())
