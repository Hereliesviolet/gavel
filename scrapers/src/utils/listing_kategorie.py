from __future__ import annotations

from typing import Optional

_WOHNUNG = ("wohnung", "appartement", "eigentumswohnung", "apartment")
_HAUS = (
    "haus",
    "villa",
    "reihen",
    "doppel",
    "einfamilien",
    "mehrfamilien",
    "anwesen",
    "resthof",
    "ruine",
)
_GRUNDSTUECK = (
    "grundstück",
    "grundstueck",
    "flurstück",
    "landwirtsch",
    "erbbau",
    "land-/forst",
    "forstwirtschaft",
    "forst",
    "gestüt",
)
_GEWERBE_FIRST = (
    "geschäftshaus",
    "geschaeftshaus",
    "wohn-/geschäft",
    "wohn-/geschaeft",
    "wohn-/gewerbe",
    "einkaufspassage",
    "einkaufszentrum",
)
_GEWERBE = (
    "gewerbe",
    "büro",
    "laden",
    "fabrik",
    "werkstatt",
    "lager",
    "gewerblich",
)


def detect_listing_kategorie(typ: str | None) -> Optional[str]:
    if not typ:
        return None
    t = typ.lower()
    if any(token in t for token in _WOHNUNG):
        return "wohnung"
    if any(token in t for token in _GEWERBE_FIRST):
        return "gewerbe"
    if any(token in t for token in _HAUS):
        return "haus"
    if any(token in t for token in _GRUNDSTUECK):
        return "grundstueck"
    if any(token in t for token in _GEWERBE):
        return "gewerbe"
    return None
