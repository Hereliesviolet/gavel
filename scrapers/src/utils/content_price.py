"""
Gemeinsam genutzte Preis-Regex für Custom-URL-Analysen.

Ausgelagert aus src/api/app.py, damit content_slicer.py (generische
Heuristik) dieselbe Regex wiederverwendet statt sie zu duplizieren.
"""

from __future__ import annotations

import re

# Ein Geldbetrag in EUR: Tausender als Punkt, Apostroph oder Leerzeichen,
# optionales Komma-Dezimal, direkt gefolgt von €/EUR. CHF ohne Umrechnung
# nicht als Euro übernehmen.
PREIS_REGEX = re.compile(r"(?:\d{1,3}(?:[.'\s]\d{3})+|\d{1,9})(?:,\d{2})?\s*(?:€|EUR(?![a-zA-Z]))")
_ZAHL = re.compile(r"[\d.'\s]+(?:,\d{2})?")

_BETRAG = re.compile(
    r"([0-9]{1,3}(?:[.'\s][0-9]{3})+|[0-9]{3,9})\s*(?:€|EUR)"
    r"(\s*(?:/|je\s|pro\s)?\s*(?:m²|m2|qm))?",
    re.IGNORECASE,
)
_KAUF_LABEL = re.compile(r"Kaufpreis", re.IGNORECASE)
_MIETE_LABEL = re.compile(
    r"(?<![A-Za-zÄÖÜäöü])(?:Nettokaltmiete|Kaltmiete|Gesamtmiete)(?![A-Za-zÄÖÜäöü])",
    re.IGNORECASE,
)
_GENERIC_PREIS = re.compile(r"(?<![A-Za-zÄÖÜäöü])Preis(?![A-Za-zÄÖÜäöü])", re.IGNORECASE)
_FREMDBETRAG = re.compile(
    r"Stellplatz|Garage|Hausgeld|Provision|Courtage|Nebenkosten|Betriebskosten"
    r"|Rate|Finanzierung|Grundsteuer|Kaution"
    r"|Jahreskaltmiete|Jahresmiete|jährlich|jaehrlich|(?<![A-Za-zÄÖÜäöü])Jahr(?![A-Za-zÄÖÜäöü])"
    r"|p\.?\s*a\.?",
    re.IGNORECASE,
)
_MONATS_HINWEIS = re.compile(r"monatlich|pro Monat", re.IGNORECASE)
_UMFELD = 45
_MIN_PREIS = 100
_MAX_PREIS = 50_000_000
_KIND_PRIO = {"fremd": 0, "kauf": 1, "miete": 1, "preis": 2, "monat": 2}


def parse_euro_amount(match_text: str) -> float | None:
    zahl = _ZAHL.search(match_text)
    if not zahl:
        return None
    digits = re.sub(r"[.'\s]", "", zahl.group(0).split(",")[0])
    if not digits.isdigit():
        return None
    return float(digits)


def _abstand(a0: int, a1: int, l0: int, l1: int) -> int:
    if l1 <= a0:
        return a0 - l1
    if l0 >= a1:
        return l0 - a1
    return 0


def _zielbetrag(
    text: str,
    l0: int,
    l1: int,
    betraege: list[tuple[int, int, int]],
) -> tuple[int, int, int] | None:
    prefix: tuple[int, int, int] | None = None
    suffix: tuple[int, int, int] | None = None
    for a0, a1, wert in betraege:
        if a0 >= l1:
            gap = text[l1:a0]
            if len(gap) <= _UMFELD and gap.strip() == "":
                if prefix is None or a0 < prefix[0]:
                    prefix = (a0, a1, wert)
        if a1 <= l0:
            gap = text[a1:l0]
            if len(gap) <= _UMFELD and gap.strip() == "":
                if suffix is None or a1 > suffix[1]:
                    suffix = (a0, a1, wert)
    if prefix:
        return prefix
    if suffix:
        return suffix
    naechster = min(betraege, key=lambda b: _abstand(b[0], b[1], l0, l1))
    if _abstand(naechster[0], naechster[1], l0, l1) > _UMFELD:
        return None
    return naechster


def _angebot_passt(kind: str | None, angebotstyp: str | None, nur_beschriftet: bool) -> bool:
    if kind == "fremd":
        return False
    if angebotstyp == "kauf":
        if kind in ("miete", "monat"):
            return False
        if kind in ("kauf", "preis"):
            return True
        return not nur_beschriftet
    if angebotstyp == "miete":
        if kind == "kauf":
            return False
        if kind in ("miete", "preis", "monat"):
            return True
        return not nur_beschriftet
    if kind == "monat":
        return False
    if kind in ("kauf", "miete", "preis"):
        return True
    return not nur_beschriftet


def angebotstyp_aus_text(text: str) -> str | None:
    """Kauf oder Miete nur, wenn genau eine der beiden Beschriftungen vorkommt."""
    hat_kauf = bool(_KAUF_LABEL.search(text))
    hat_miete = bool(_MIETE_LABEL.search(text))
    if hat_kauf and not hat_miete:
        return "kauf"
    if hat_miete and not hat_kauf:
        return "miete"
    return None


def nachpruef_typ(gespeichert: str | None, text: str) -> tuple[str | None, bool]:
    bestand = (gespeichert or "").strip()
    erkannt = angebotstyp_aus_text(text) or ""
    if bestand in ("kauf", "miete") and erkannt in ("kauf", "miete") and erkannt != bestand:
        return erkannt, True
    if bestand in ("kauf", "miete"):
        return bestand, False
    if erkannt in ("kauf", "miete"):
        return erkannt, False
    return None, False


def _preis_int(value: int | float | None) -> int | None:
    if value is None:
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def abgleich_angebot_extraktion(
    gespeichert: str | None,
    llm_typ: str | None,
    llm_preis: int | float | None,
    text: str,
) -> tuple[str | None, int | None]:
    """Koppelt LLM-Typ/Preis an eindeutige Textbeschriftung.

    Ein Typwechsel braucht dasselbe Signal wie die wöchentliche Nachprüfung:
    genau eine Kauf- oder Mietbeschriftung plus passenden Betrag. Sonst bleibt
    der gespeicherte Typ, und der LLM-Preis wird nicht geschrieben.
    """
    bestand = (gespeichert or "").strip() or None
    llm = (llm_typ or "").strip() or None
    llm_p = _preis_int(llm_preis)
    erkannt = angebotstyp_aus_text(text)
    _, typwechsel = nachpruef_typ(bestand, text)

    if typwechsel:
        text_preis = preis_aus_text(text, erkannt)
        if text_preis is None:
            return bestand, None
        return erkannt, text_preis

    if erkannt in ("kauf", "miete"):
        if llm == erkannt:
            return erkannt, llm_p
        return erkannt, preis_aus_text(text, erkannt)

    if bestand in ("kauf", "miete") and llm in ("kauf", "miete") and llm != bestand:
        return bestand, None
    return (llm if llm in ("kauf", "miete") else bestand), llm_p


def preis_aus_text(
    text: str,
    angebotstyp: str | None = None,
    *,
    nur_beschriftet: bool = True,
) -> int | None:
    """Erster Angebotspreis im Text, der zur Angebotsart passt.

    Jede Beschriftung hängt am nächsten Betrag. So überschreibt eine
    Bestandsmiete auf einem Kaufinserat nicht den Kaufpreis, und Hausgeld
    oder Kaution werden nicht als Angebotspreis gelesen.
    """
    betraege: list[tuple[int, int, int]] = []
    for treffer in _BETRAG.finditer(text):
        if treffer.group(2):
            continue
        try:
            wert = int(re.sub(r"[.'\s]", "", treffer.group(1)))
        except ValueError:
            continue
        if _MIN_PREIS <= wert <= _MAX_PREIS:
            betraege.append((treffer.start(), treffer.end(), wert))
    if not betraege:
        return None

    labels: list[tuple[int, int, str]] = []
    for regex, kind in (
        (_FREMDBETRAG, "fremd"),
        (_KAUF_LABEL, "kauf"),
        (_MIETE_LABEL, "miete"),
        (_GENERIC_PREIS, "preis"),
        (_MONATS_HINWEIS, "monat"),
    ):
        for treffer in regex.finditer(text):
            labels.append((treffer.start(), treffer.end(), kind))

    if angebotstyp not in ("kauf", "miete"):
        hat_kauf = any(kind == "kauf" for _, _, kind in labels)
        hat_miete = any(kind == "miete" for _, _, kind in labels)
        if hat_kauf and hat_miete:
            return None

    for a0, a1, wert in betraege:
        gebunden: list[tuple[int, int, str]] = []
        for l0, l1, kind in labels:
            ziel = _zielbetrag(text, l0, l1, betraege)
            if ziel is None or ziel[0] != a0 or ziel[1] != a1:
                continue
            gebunden.append((_abstand(a0, a1, l0, l1), _KIND_PRIO[kind], kind))
        if any(k == "fremd" for _, _, k in gebunden):
            kind = "fremd"
        else:
            kind = min(gebunden)[2] if gebunden else None
        if _angebot_passt(kind, angebotstyp, nur_beschriftet):
            return wert
    return None


def preiszeile_aus_text(
    text: str,
    angebotstyp: str | None = None,
    *,
    nur_beschriftet: bool = True,
) -> str | None:
    wert = preis_aus_text(text, angebotstyp, nur_beschriftet=nur_beschriftet)
    if wert is None:
        return None
    hat_kauf = bool(_KAUF_LABEL.search(text))
    hat_miete = bool(_MIETE_LABEL.search(text))
    if hat_miete and not hat_kauf:
        return f"Kaltmiete: {wert} €"
    if hat_kauf and not hat_miete:
        return f"Kaufpreis: {wert} €"
    return f"Preis: {wert} €"
