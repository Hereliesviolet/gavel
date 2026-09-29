from __future__ import annotations

import re
from typing import Optional

_AREA_NUM = r"(\d{1,3}(?:\.\d{3})+|\d+(?:[.,]\d{1,2})?)"
_M2 = r"m[²2]"

_NUTZ_BLOCK = re.compile(
    r"Nutzfl(?:ä|ae)chen?\s+betragen[:\s]+(.+?)(?:\.\s+[A-ZÄÖÜ]|$)",
    re.IGNORECASE | re.DOTALL,
)
_AREA_IN_BLOCK = re.compile(rf"{_AREA_NUM}\s*{_M2}", re.IGNORECASE)
_WOHN_AFTER = re.compile(
    rf"(?:ca\.\s*)?{_AREA_NUM}\s*{_M2}\s*(?:insg\.?\s*)?Wohnfl",
    re.IGNORECASE,
)
_WOHN_LABELED = re.compile(
    rf"Wohnfl(?:ä|ae)che(?:n)?(?:\s+insg\.?)?[:\s,]*?(?:ca\.\s*)?{_AREA_NUM}\s*{_M2}",
    re.IGNORECASE,
)
_GRUNDSTUECK_PREFIX = re.compile(
    r"grundst(?:ü|ue)ck",
    re.IGNORECASE,
)
_WE_AREA = re.compile(
    rf"WE\s*\d+\s*\([^)]*?{_AREA_NUM}\s*{_M2}",
    re.IGNORECASE,
)
_GESAMT_WOHN = re.compile(
    rf"Gesamt[-\s]?Wohnfl(?:ä|ae)che[:\s,]*?(?:ca\.\s*)?{_AREA_NUM}\s*{_M2}",
    re.IGNORECASE,
)


def parse_de_area(raw: str) -> Optional[float]:
    s = (raw or "").strip().replace("\u00a0", "").replace(" ", "")
    if not s:
        return None
    try:
        if "," in s:
            return float(s.replace(".", "").replace(",", "."))
        if "." in s:
            parts = s.split(".")
            if parts[1:] and all(len(p) == 3 for p in parts[1:]):
                return float("".join(parts))
            if len(parts) == 2 and 1 <= len(parts[1]) <= 2:
                return float(s)
            return None
        return float(s)
    except ValueError:
        return None


def _areas(pattern: re.Pattern[str], text: str) -> list[float]:
    out: list[float] = []
    for match in pattern.finditer(text):
        value = parse_de_area(match.group(1))
        if value is not None and 1 <= value <= 500_000:
            out.append(value)
    return out


def _wohnflaechen(text: str) -> list[float]:
    found: list[float] = []
    for match in _WOHN_AFTER.finditer(text):
        prefix = text[max(0, match.start() - 60) : match.start()]
        if _GRUNDSTUECK_PREFIX.search(prefix):
            continue
        value = parse_de_area(match.group(1))
        if value is not None and 1 <= value <= 500_000:
            found.append(value)
    if found:
        return found
    return _areas(_WOHN_LABELED, text)


def extract_flaechen_from_text(text: str | None) -> dict[str, float]:
    """Wohn- und Nutzfläche aus Amts-/Portaltext, Summe statt erster Zahl."""
    if not text:
        return {}
    result: dict[str, float] = {}

    nutz_values: list[float] = []
    block = _NUTZ_BLOCK.search(text)
    if block:
        nutz_values = _areas(_AREA_IN_BLOCK, block.group(1))
    if len(nutz_values) >= 2:
        result["nutzflaeche_m2"] = round(sum(nutz_values), 2)
    elif len(nutz_values) == 1:
        result["nutzflaeche_m2"] = round(nutz_values[0], 2)

    wohn_values = _wohnflaechen(text)
    we_values = _areas(_WE_AREA, text)
    gesamt_wohn = _areas(_GESAMT_WOHN, text)

    if gesamt_wohn:
        result["wohnflaeche_m2"] = round(gesamt_wohn[0], 2)
    elif len(we_values) >= 2:
        result["wohnflaeche_m2"] = round(sum(we_values), 2)
    elif len(wohn_values) >= 2 and len(set(wohn_values)) == 1:
        result["wohnflaeche_m2"] = round(wohn_values[0], 2)
    elif len(wohn_values) >= 2:
        result["wohnflaeche_m2"] = round(sum(wohn_values), 2)
    elif len(wohn_values) == 1:
        result["wohnflaeche_m2"] = round(wohn_values[0], 2)
    elif len(we_values) == 1:
        result["wohnflaeche_m2"] = round(we_values[0], 2)

    return result
