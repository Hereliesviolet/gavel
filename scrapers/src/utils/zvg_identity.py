import re

_SLUG_MAX = 120


def normalize_amtsgericht(wert: str | None) -> str | None:
    """Vereinheitlicht die Gerichtsbezeichnung, weil sie Teil der Objektidentität ist.

    Die Quellen schreiben "AG Landshut", "Amtsgericht  Landshut" und "Landshut"
    für dasselbe Gericht. Ohne Normalisierung wäre dasselbe Verfahren drei
    verschiedene Objekte, sobald amtsgericht im Unique-Index steht
    (siehe drizzle/migrations/0020_zvg_identity_auction_events.sql).
    """
    if not wert:
        return None
    bereinigt = re.sub(r"\s+", " ", wert).strip()
    bereinigt = re.sub(r"^(?:amtsgericht|amtsg\.?|ag)\s+", "", bereinigt, flags=re.IGNORECASE)
    bereinigt = bereinigt.strip(" -–,")
    return bereinigt or None


def orts_compatible(stored: str | None, incoming: str | None) -> bool:
    def norm(value: str | None) -> str:
        text = re.sub(r"\s+", " ", (value or "").strip().lower())
        for old, new in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
            text = text.replace(old, new)
        return text

    left = norm(stored)
    right = norm(incoming)
    return not left or not right or left == right


def listing_identity_key(
    bundesland: str | None,
    amtsgericht: str | None,
    aktenzeichen: str | None,
) -> tuple[str, str, str]:
    return (
        (bundesland or "").strip(),
        normalize_amtsgericht(amtsgericht) or "",
        (aktenzeichen or "").strip(),
    )


def _slugify(text: str) -> str:
    text = text.lower()
    for old, new in [("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss"), ("/", "-"), ("|", "-")]:
        text = text.replace(old, new)
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")[:_SLUG_MAX]


def zvg_listing_slug(
    aktenzeichen: str,
    bundesland: str,
    *,
    amtsgericht: str | None = None,
    ort: str | None = None,
    marker: str | None = None,
) -> str:
    parts = [aktenzeichen]
    if marker:
        parts.append(marker)
    parts.append(bundesland)
    court = normalize_amtsgericht(amtsgericht)
    if court:
        parts.append(court)
    if ort:
        parts.append(ort)
    return _slugify("-".join(part for part in parts if part)) or "objekt"
