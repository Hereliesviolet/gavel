"""
Zentrale Datenqualitäts-/Plausibilitäts-Engine für Gavel (2026-07-04).

Hintergrund: Mehrere konkrete Datenfehler (fehlendes Geocoding, Bundesland-
Slug-Chaos, KI-Flächenzuordnung beim falschen Teilobjekt einer
Mehrfach-Los-Zwangsversteigerung) wurden bisher ausschließlich REAKTIV
gefunden, weil ein Nutzer zufällig ein falsches Objekt entdeckt hat. Dieses
Modul ersetzt das durch eine PROAKTIVE, nachgelagerte Validierungsschicht:

  - Läuft NACH dem Scraping/der KI-Anreicherung (ändert deren Werte NICHT).
  - Prüft jedes wichtige strukturierte Feld gegen einen definierten
    Plausibilitätsbereich bzw. eine Konsistenzregel.
  - Werte außerhalb des Bereichs werden NICHT verworfen (das könnte echte,
    aber unübliche Fälle fälschlich unsichtbar machen), sondern als
    "needs_review"-Flag in `zvg_listings.data_quality_flags` (JSONB)
    gespeichert und geloggt - sichtbar statt still falsch.
  - Ergänzt eine Cross-Validation zwischen KI-Freitext-Extraktion und
    strukturiert gescrapten Rohdaten (siehe cross_validate_ki_result()).

WICHTIG: Dies ist bewusst eine NACHGELAGERTE Schicht. Die eigentliche
Scraping-/KI-Extraktionslogik wird hier NICHT verändert (siehe Aufgaben-
Rahmenbedingungen) - nur zwei klar identifizierte, gezielte Lücken wurden
zusätzlich behoben (siehe zvg_portal.py/_parse_euro-Kommentar und
hanmark.py/zvg_com.py: keine der drei Quellen hatte vorher überhaupt eine
harte Verkehrswert-Bereichsprüfung außer zvg_portal.py, UND diese verwarf
Werte außerhalb des Bereichs bisher komplett (auf None) statt sie nur zu
flaggen - beides widersprach dem neuen "sichtbar statt verworfen"-Prinzip).

Neue Quellen/Prompt-Änderungen einbinden: siehe docs/DATA_QUALITY.md.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

_BERLIN = ZoneInfo("Europe/Berlin")

RULES_VERSION = "1.0.0"  # bei Regeländerungen erhöhen (siehe docs/DATA_QUALITY.md)

Severity = str  # "critical" | "warning" | "info"


@dataclass
class QualityFlag:
    field: str
    reason: str
    message: str
    severity: Severity = "warning"
    value: Any = None
    expected: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "field": self.field,
            "reason": self.reason,
            "message": self.message,
            "severity": self.severity,
            "value": _jsonable(self.value),
            "expected": self.expected,
            "rules_version": RULES_VERSION,
        }


def _jsonable(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, (int, float, str, bool)) or value is None:
        return value
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    return str(value)


# ─────────────────────────────────────────────────────────────────────────
# Plausibilitätsbereiche (bewusst großzügig gewählt, um reale aber
# untypische Fälle nicht fälschlich als Fehler zu behandeln - Ziel ist
# grobe Ausreißer-Erkennung, keine harte Validierung).
# ─────────────────────────────────────────────────────────────────────────

WOHNFLAECHE_M2_RANGE = (5.0, 2000.0)
NUTZFLAECHE_M2_RANGE = (5.0, 100_000.0)
GESAMTFLAECHE_M2_RANGE = (5.0, 100_000.0)
GRUNDSTUECKSFLAECHE_M2_RANGE_BY_KATEGORIE: dict[Optional[str], tuple[float, float]] = {
    "grundstueck": (10.0, 5_000_000.0),  # Land-/Forstwirtschaft kann riesig sein
    "gewerbe": (10.0, 500_000.0),
    None: (5.0, 50_000.0),  # Default für wohnung/haus/unbekannt
}

ZIMMER_RANGE = (0.5, 40.0)
BAUJAHR_MIN = 1800
BAUJAHR_MAX_OFFSET_YEARS = 2  # aktuelles Jahr + 2 (Neubau-Projekte im Bau)

# Verkehrswert absolute Grenzen - bisher NUR in zvg_portal.py als
# _parse_euro()-Filter vorhanden (und dort ein VERWERFEN statt Flaggen,
# siehe Modul-Docstring). Jetzt einheitlich für alle drei Quellen.
VERKEHRSWERT_ABSOLUTE_RANGE = (1_000, 50_000_000)
VERKEHRSWERT_ABSOLUTE_RANGE_BY_KATEGORIE: dict[str, tuple[float, float]] = {
    "gewerbe": (1_000, 250_000_000),
}
# Oberhalb dieses Werts gilt ein gespeicherter Verkehrswert beim Upsert
# als Parse-Müll und wird nicht gegen den neuen Wert geschützt.
VERKEHRSWERT_UPSERT_PLAUSIBLE_RANGE = (1_000, 500_000_000)

# €/m² Plausibilitätsbereiche nach Kategorie (grobe Deutschland-weite
# Spannbreite von strukturschwacher Landregion bis Toplage München/Hamburg).
VERKEHRSWERT_EUR_PRO_M2_RANGES: dict[str, tuple[float, float]] = {
    "wohnung": (200.0, 15_000.0),
    "haus": (150.0, 12_000.0),
    "gewerbe": (30.0, 12_000.0),
    "grundstueck": (1.0, 3_000.0),  # bezogen auf Grundstücksfläche (bodenrichtwertartig)
}

AUSWEISJAHR_MIN = 1995
ENDENERGIEVERBRAUCH_KWH_RANGE = (0.0, 600.0)

# Grobe Zuordnung Effizienzklasse → erwarteter Endenergieverbrauch (kWh/m²a),
# angelehnt an die im GEG üblichen Bandgrenzen. Nur zur Plausibilitätsprüfung,
# keine Norm-Referenz.
EFFIZIENZKLASSE_KWH_MAX: dict[str, float] = {
    "A+": 30.0,
    "A": 50.0,
    "B": 75.0,
    "C": 100.0,
    "D": 130.0,
    "E": 160.0,
    "F": 200.0,
    "G": 250.0,
    "H": float("inf"),
}

TERMIN_MAX_FUTURE_DAYS = 730  # >2 Jahre in der Zukunft ist verdächtig

PLZ_PATTERN = re.compile(r"^\d{5}$")
# Aktenzeichen: muss mindestens eine Ziffer enthalten, nur "normale" Zeichen,
# vernünftige Länge. Bewusst LOCKER (viele Formate: "12 K 34/25",
# "0021 K 0024/2025", "1 K 65/25#1", ...) - Ziel ist nur, offensichtlich
# kaputte Parses (leer, nur Sonderzeichen, HTML-Reste, Riesenstrings) zu fangen.
AKTENZEICHEN_ALLOWED_CHARS = re.compile(r"^[\w\s\.\-/#§()]+$", re.UNICODE)
AKTENZEICHEN_HAS_DIGIT = re.compile(r"\d")

# PLZ-Leitzone (erste Ziffer) → plausible Bundesländer (kanonische Slugs,
# siehe src/utils/bundesland.py). Quelle: offizielle DHL/Post-Leitzonen-
# Einteilung. Bewusst auf Zonen-Ebene (nicht die granularere 2-stellige
# Leitregion), da Zonengrenzen NICHT an Bundeslandgrenzen ausgerichtet sind
# und echte Grenzfälle sonst zu Unrecht geflaggt würden - diese Prüfung soll
# nur grobe Fehlzuordnungen (z.B. PLZ 8xxxx mit bundesland=hamburg) fangen.
PLZ_ZONE_TO_BUNDESLAENDER: dict[str, set[str]] = {
    "0": {"sachsen", "thueringen", "sachsen-anhalt", "brandenburg"},
    "1": {"berlin", "brandenburg", "mecklenburg-vorpommern", "niedersachsen", "sachsen-anhalt"},
    "2": {
        "schleswig-holstein",
        "bremen",
        "hamburg",
        "niedersachsen",
        "mecklenburg-vorpommern",
        "sachsen-anhalt",
    },
    "3": {"niedersachsen", "sachsen-anhalt", "hessen", "thueringen", "nordrhein-westfalen"},
    "4": {"nordrhein-westfalen", "niedersachsen"},
    "5": {"rheinland-pfalz", "nordrhein-westfalen", "hessen"},
    "6": {"hessen", "saarland", "rheinland-pfalz", "badenwuerttemberg", "bayern"},
    "7": {"badenwuerttemberg", "rheinland-pfalz", "bayern"},
    "8": {"badenwuerttemberg", "bayern"},
    "9": {"badenwuerttemberg", "bayern", "thueringen"},
}

# Freitextfelder, deren Inhalt (falls vorhanden) auf verdächtig kurze/generische
# KI-Ausgaben geprüft wird (reine Beobachtungs-/Debugging-Hilfe, severity=info -
# setzt NICHT needs_review, da oft schlicht "kein Gutachten-Text verfügbar").
_KI_FREETEXT_FIELDS = [
    "beschreibung",
    "maengel_kurz",
    "lage_charakter",
    "lage_umgebung",
    "zustand_innen",
    "zustand_aussen",
]
_GENERIC_PLACEHOLDERS = {
    "keine angaben",
    "k.a.",
    "n/a",
    "unbekannt",
    "keine angabe",
    "nicht angegeben",
    "-",
    "keine informationen",
    "keine daten",
}


def _in_range(value: Optional[float], lo: float, hi: float) -> bool:
    return value is not None and lo <= value <= hi


def _check_range(
    flags: list[QualityFlag],
    field_name: str,
    value: Optional[float],
    lo: float,
    hi: float,
    unit: str = "",
    severity: Severity = "warning",
) -> None:
    if value is None:
        return
    try:
        v = float(value)
    except (TypeError, ValueError):
        flags.append(
            QualityFlag(
                field=field_name,
                reason="not_numeric",
                value=value,
                severity="warning",
                message=f"{field_name}={value!r} ist kein gültiger Zahlenwert.",
            )
        )
        return
    if not (lo <= v <= hi):
        flags.append(
            QualityFlag(
                field=field_name,
                reason="outside_plausible_range",
                value=v,
                expected=f"[{lo}, {hi}] {unit}".strip(),
                severity=severity,
                message=(
                    f"{field_name}={v:g}{(' ' + unit) if unit else ''} liegt außerhalb des "
                    f"plausiblen Bereichs [{lo:g}, {hi:g}] {unit}."
                ),
            )
        )


def check_flaechen(listing: dict) -> list[QualityFlag]:
    """Wohnfläche, Grundstücksfläche, Nutzfläche, Gesamtfläche + Konsistenz."""
    flags: list[QualityFlag] = []
    kategorie = listing.get("kategorie")

    _check_range(
        flags, "wohnflaeche_m2", listing.get("wohnflaeche_m2"), *WOHNFLAECHE_M2_RANGE, unit="m²"
    )
    _check_range(
        flags, "nutzflaeche_m2", listing.get("nutzflaeche_m2"), *NUTZFLAECHE_M2_RANGE, unit="m²"
    )
    _check_range(
        flags,
        "gesamtflaeche_m2",
        listing.get("gesamtflaeche_m2"),
        *GESAMTFLAECHE_M2_RANGE,
        unit="m²",
    )

    gs_lo, gs_hi = GRUNDSTUECKSFLAECHE_M2_RANGE_BY_KATEGORIE.get(
        kategorie, GRUNDSTUECKSFLAECHE_M2_RANGE_BY_KATEGORIE[None]
    )
    _check_range(
        flags,
        "grundstuecksflaeche_m2",
        listing.get("grundstuecksflaeche_m2"),
        gs_lo,
        gs_hi,
        unit="m²",
    )

    # Konsistenz: bei "haus" sollte die Wohnfläche das Grundstück nicht um ein
    # Vielfaches übersteigen (würde ein absurd hohes Gebäude implizieren).
    wf = listing.get("wohnflaeche_m2")
    gf = listing.get("grundstuecksflaeche_m2")
    if kategorie == "haus" and wf and gf and float(gf) > 0 and float(wf) > float(gf) * 3:
        flags.append(
            QualityFlag(
                field="wohnflaeche_m2",
                reason="wohnflaeche_grosser_als_grundstueck",
                value=float(wf),
                expected=f"<= 3x grundstuecksflaeche_m2 ({gf})",
                severity="warning",
                message=(
                    f"Wohnfläche ({float(wf):g} m²) ist mehr als 3x größer als die "
                    f"Grundstücksfläche ({float(gf):g} m²) - für ein Haus untypisch, "
                    f"ggf. falsches Teilobjekt/Los zugeordnet."
                ),
            )
        )
    return flags


def check_zimmer(listing: dict) -> list[QualityFlag]:
    flags: list[QualityFlag] = []
    _check_range(flags, "zimmer", listing.get("zimmer"), *ZIMMER_RANGE)
    return flags


def check_baujahr(listing: dict) -> list[QualityFlag]:
    flags: list[QualityFlag] = []
    current_year = datetime.now(timezone.utc).year
    _check_range(
        flags,
        "baujahr",
        listing.get("baujahr"),
        BAUJAHR_MIN,
        current_year + BAUJAHR_MAX_OFFSET_YEARS,
    )
    return flags


def check_verkehrswert(listing: dict) -> list[QualityFlag]:
    """Absolute Grenzen + €/m²-Plausibilität je Objektkategorie.

    Ersetzt/vereinheitlicht die bisher inkonsistente Situation:
    zvg_portal.py verwarf Werte außerhalb [1.000, 50.000.000] € komplett
    (still, kein Flag) - hanmark.de und zvg.com hatten GAR KEINE
    Bereichsprüfung. Jetzt: alle drei Quellen laufen durch dieselbe Prüfung,
    Werte werden dabei nur geflaggt, nie verworfen.
    """
    flags: list[QualityFlag] = []
    vw = listing.get("verkehrswert")
    if vw is None:
        return flags
    try:
        vw = float(vw)
    except (TypeError, ValueError):
        return flags

    kategorie = listing.get("kategorie")
    lo, hi = VERKEHRSWERT_ABSOLUTE_RANGE_BY_KATEGORIE.get(kategorie, VERKEHRSWERT_ABSOLUTE_RANGE)
    if not (lo <= vw <= hi):
        flags.append(
            QualityFlag(
                field="verkehrswert",
                reason="outside_absolute_range",
                value=vw,
                expected=f"[{lo}, {hi}] EUR",
                severity="critical",
                message=f"Verkehrswert {vw:,.0f} € liegt außerhalb des plausiblen Absolutbereichs [{lo:,}, {hi:,}] €.",
            )
        )

    if not kategorie or kategorie not in VERKEHRSWERT_EUR_PRO_M2_RANGES:
        return flags

    if kategorie == "grundstueck":
        flaeche_feld = "grundstuecksflaeche_m2"
    elif kategorie == "gewerbe" and listing.get("nutzflaeche_m2"):
        flaeche_feld = "nutzflaeche_m2"
    else:
        flaeche_feld = "wohnflaeche_m2"
    flaeche = listing.get(flaeche_feld)
    if not flaeche:
        return flags
    try:
        flaeche = float(flaeche)
    except (TypeError, ValueError):
        return flags
    if flaeche <= 0:
        return flags

    eur_pro_m2 = vw / flaeche
    lo_m2, hi_m2 = VERKEHRSWERT_EUR_PRO_M2_RANGES[kategorie]
    if not (lo_m2 <= eur_pro_m2 <= hi_m2):
        flags.append(
            QualityFlag(
                field="verkehrswert",
                reason="eur_pro_m2_outside_range",
                value=round(eur_pro_m2, 2),
                expected=f"[{lo_m2:g}, {hi_m2:g}] EUR/m² ({flaeche_feld})",
                severity="warning",
                message=(
                    f"Verkehrswert {vw:,.0f} € / {flaeche_feld}={flaeche:g} m² = {eur_pro_m2:,.0f} €/m², "
                    f"außerhalb des für '{kategorie}' plausiblen Bereichs [{lo_m2:g}, {hi_m2:g}] €/m² "
                    f"- ggf. falsches Teilobjekt/Los oder Flächen-Fehlzuordnung."
                ),
            )
        )
    return flags


def check_aktenzeichen(listing: dict) -> list[QualityFlag]:
    flags: list[QualityFlag] = []
    az = (listing.get("aktenzeichen") or "").strip()
    if not az:
        flags.append(
            QualityFlag(
                field="aktenzeichen",
                reason="empty",
                value=az,
                severity="critical",
                message="Aktenzeichen ist leer.",
            )
        )
        return flags
    if len(az) > 60:
        flags.append(
            QualityFlag(
                field="aktenzeichen",
                reason="unusual_length",
                value=az,
                severity="warning",
                message=f"Aktenzeichen ist ungewöhnlich lang ({len(az)} Zeichen) - ggf. Parse-Fehler.",
            )
        )
    if not AKTENZEICHEN_HAS_DIGIT.search(az):
        flags.append(
            QualityFlag(
                field="aktenzeichen",
                reason="no_digits",
                value=az,
                severity="warning",
                message="Aktenzeichen enthält keine Ziffer - für ein ZVG-Aktenzeichen untypisch.",
            )
        )
    if not AKTENZEICHEN_ALLOWED_CHARS.match(az):
        flags.append(
            QualityFlag(
                field="aktenzeichen",
                reason="unexpected_characters",
                value=az,
                severity="warning",
                message="Aktenzeichen enthält unerwartete Zeichen (ggf. HTML-/Parse-Reste).",
            )
        )
    return flags


def _is_berlin_date_only(termin: datetime) -> bool:
    local = termin.astimezone(_BERLIN)
    return local.hour == 0 and local.minute == 0 and local.second == 0 and local.microsecond == 0


def termin_ist_abgelaufen(termin: datetime, now: datetime | None = None) -> bool:
    """Archiv/UI: date-only (Berlin 00:00) erst nach dem Kalendertag, sonst termin < now."""
    if now is None:
        now = datetime.now(timezone.utc)
    if termin.tzinfo is None:
        termin = termin.replace(tzinfo=timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    if _is_berlin_date_only(termin):
        return termin.astimezone(_BERLIN).date() < now.astimezone(_BERLIN).date()
    return termin < now


def check_termin(listing: dict, now: datetime | None = None) -> list[QualityFlag]:
    flags: list[QualityFlag] = []
    termin = listing.get("termin_date")
    if termin is None:
        return flags
    if isinstance(termin, str):
        try:
            termin = datetime.fromisoformat(termin)
        except ValueError:
            flags.append(
                QualityFlag(
                    field="termin_date",
                    reason="not_parseable",
                    value=termin,
                    severity="warning",
                    message=f"termin_date={termin!r} lässt sich nicht als Datum parsen.",
                )
            )
            return flags
    if termin.tzinfo is None:
        termin = termin.replace(tzinfo=timezone.utc)
    if now is None:
        now = datetime.now(timezone.utc)
    elif now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)

    # ist_aktiv=TRUE + Termin in der Vergangenheit sollte durch die tägliche
    # Archivierung (archive_past_listings.py) eigentlich nicht vorkommen -
    # wird trotzdem hier zusätzlich sichtbar gemacht (z.B. bei Ausfall des
    # Archivierungs-Laufs), separat von dessen eigener Logik.
    if listing.get("ist_aktiv", True) and termin_ist_abgelaufen(termin, now):
        flags.append(
            QualityFlag(
                field="termin_date",
                reason="past_but_active",
                value=termin,
                severity="warning",
                message=(
                    f"Termin {termin.date()} liegt in der Vergangenheit, Objekt ist aber "
                    f"weiterhin als aktiv markiert (sollte durch die tägliche Archivierung "
                    f"abgefangen werden - ggf. Archivierungslauf geprüft)."
                ),
            )
        )

    days_ahead = (termin - now).days
    if days_ahead > TERMIN_MAX_FUTURE_DAYS:
        flags.append(
            QualityFlag(
                field="termin_date",
                reason="unusually_far_future",
                value=termin,
                expected=f"<= {TERMIN_MAX_FUTURE_DAYS} Tage in der Zukunft",
                severity="info",
                message=f"Termin liegt {days_ahead} Tage in der Zukunft (>{TERMIN_MAX_FUTURE_DAYS} Tage) - unüblich lange Vorlaufzeit.",
            )
        )
    return flags


def check_plz_ort_bundesland(listing: dict) -> list[QualityFlag]:
    flags: list[QualityFlag] = []
    plz = (listing.get("plz") or "").strip()
    bundesland = (listing.get("bundesland") or "").strip()

    if not plz:
        return flags
    if not PLZ_PATTERN.match(plz):
        flags.append(
            QualityFlag(
                field="plz",
                reason="malformed",
                value=plz,
                severity="warning",
                message=f"PLZ '{plz}' ist keine gültige 5-stellige deutsche Postleitzahl.",
            )
        )
        return flags

    if not bundesland:
        return flags
    if plz.startswith("00"):
        # Justizportal anonymisiert vereinzelt die PLZ zu "00000" (siehe auch
        # geocoding.py) - das ist bewusst und kein Datenfehler, daher keine
        # Bundesland-Konsistenzprüfung für diesen Sentinel-Wert.
        return flags
    plausible = PLZ_ZONE_TO_BUNDESLAENDER.get(plz[0])
    if plausible and bundesland not in plausible:
        flags.append(
            QualityFlag(
                field="plz",
                reason="plz_bundesland_mismatch",
                value=plz,
                expected=f"Bundesland in {sorted(plausible)} (PLZ-Leitzone {plz[0]})",
                severity="warning",
                message=(
                    f"PLZ '{plz}' (Leitzone {plz[0]}) passt nicht zum angegebenen Bundesland "
                    f"'{bundesland}' - plausibel wären: {sorted(plausible)}."
                ),
            )
        )
    return flags


def check_energieausweis(ki: dict) -> list[QualityFlag]:
    """Prüft Energieausweis-Werte aus der KI-Analyse (zvg_ki_analyses)."""
    flags: list[QualityFlag] = []
    if not ki:
        return flags

    ausweisjahr = ki.get("ausweisjahr")
    if ausweisjahr:
        current_year = datetime.now(timezone.utc).year
        _check_range(flags, "ausweisjahr", ausweisjahr, AUSWEISJAHR_MIN, current_year + 1)

    kwh = ki.get("endenergieverbrauch_kwh")
    if kwh is not None:
        _check_range(
            flags, "endenergieverbrauch_kwh", kwh, *ENDENERGIEVERBRAUCH_KWH_RANGE, unit="kWh/m²a"
        )

    klasse = ki.get("effizienzklasse")
    if klasse and kwh is not None and klasse in EFFIZIENZKLASSE_KWH_MAX:
        try:
            kwh_f = float(kwh)
        except (TypeError, ValueError):
            kwh_f = None
        if kwh_f is not None:
            max_for_class = EFFIZIENZKLASSE_KWH_MAX[klasse]
            # eine Klasse "darunter" als Toleranz zulassen (Bandgrenzen sind fließend)
            classes = list(EFFIZIENZKLASSE_KWH_MAX.keys())
            idx = classes.index(klasse)
            tolerance_max = EFFIZIENZKLASSE_KWH_MAX[classes[min(idx + 1, len(classes) - 1)]]
            if kwh_f > tolerance_max:
                flags.append(
                    QualityFlag(
                        field="effizienzklasse",
                        reason="inconsistent_with_verbrauch",
                        value=f"{klasse} bei {kwh_f:g} kWh/m²a",
                        severity="warning",
                        expected=f"<= ~{max_for_class:g} kWh/m²a für Klasse {klasse}",
                        message=(
                            f"Effizienzklasse {klasse} passt nicht zum angegebenen "
                            f"Endenergieverbrauch von {kwh_f:g} kWh/m²a (erwartet grob "
                            f"<= {max_for_class:g})."
                        ),
                    )
                )

    if ki.get("energieausweis_vorhanden") is False and (klasse or kwh is not None):
        flags.append(
            QualityFlag(
                field="energieausweis_vorhanden",
                reason="inconsistent_flag",
                value=False,
                severity="info",
                message="energieausweis_vorhanden=False, obwohl Effizienzklasse/Verbrauchswerte vorhanden sind.",
            )
        )
    return flags


def check_ki_freitext(ki: dict) -> list[QualityFlag]:
    """Beobachtungshilfe für verdächtig kurze/generische KI-Freitextfelder.

    Severity=info (setzt KEIN needs_review) - eine kurze/generische Angabe
    kann schlicht bedeuten, dass das Gutachten dazu nichts hergab. Dient nur
    der Sichtbarkeit/Debugging, nicht der harten Fehlererkennung.
    """
    flags: list[QualityFlag] = []
    if not ki:
        return flags
    for f in _KI_FREETEXT_FIELDS:
        val = ki.get(f)
        if val is None:
            continue
        text = str(val).strip()
        if not text:
            continue
        if len(text) < 8 or text.lower() in _GENERIC_PLACEHOLDERS:
            flags.append(
                QualityFlag(
                    field=f,
                    reason="freetext_short_or_generic",
                    value=text[:120],
                    severity="info",
                    message=f"KI-Freitextfeld '{f}' ist sehr kurz/generisch ('{text[:60]}') - ggf. keine Information im Gutachten gefunden.",
                )
            )
    return flags


def cross_validate_ki_result(listing: dict, ki_result: dict) -> list[QualityFlag]:
    """
    Cross-Validation: vergleicht von der KI aus dem Gutachtentext extrahierte
    strukturierte Werte (wohnflaeche_m2, grundstuecksflaeche_m2, zimmer,
    baujahr) mit bereits vorhandenen, strukturiert gescrapten Rohwerten
    (falls die jeweilige Quelle diese direkt liefert - aktuell scrapt keine
    der drei Quellen diese Felder direkt aus Tabelle/API, sie stammen
    praktisch immer aus der KI-Extraktion selbst; die Prüfung greift daher
    vor allem für zukünftige Quellen, die diese Felder strukturiert liefern,
    ODER bei einer Re-Analyse, deren Ergebnis von einer früheren KI-Analyse
    abweicht).

    Bei Abweichung: der bereits gespeicherte (typischerweise ältere bzw. aus
    strukturierterer Quelle stammende) Wert bleibt maßgeblich - das ist
    bereits durch COALESCE in update_listing_grunddaten() strukturell
    sichergestellt (schreibt nur NULL-Felder). Diese Funktion ergänzt das um
    eine SICHTBARE Flag-/Log-Meldung, statt die Abweichung stillschweigend
    zu verwerfen bzw. zu überschreiben.
    """
    flags: list[QualityFlag] = []
    comparable = [
        ("wohnflaeche_m2", 0.15),
        ("grundstuecksflaeche_m2", 0.15),
        ("zimmer", 0.01),
        ("baujahr", 0),
    ]
    for feld, rel_tol in comparable:
        raw_value = listing.get(feld)
        ki_value = ki_result.get(feld)
        if raw_value is None or ki_value is None:
            continue
        try:
            raw_f = float(raw_value)
            ki_f = float(ki_value)
        except (TypeError, ValueError):
            continue

        if feld == "baujahr":
            deviates = raw_f != ki_f
        else:
            tol = max(abs(raw_f) * rel_tol, 1.0)
            deviates = abs(raw_f - ki_f) > tol

        if deviates:
            flags.append(
                QualityFlag(
                    field=feld,
                    reason="ki_raw_mismatch",
                    value={"raw": raw_f, "ki_extracted": ki_f},
                    severity="warning",
                    message=(
                        f"{feld}: bereits gespeicherter Wert ({raw_f:g}) weicht von der "
                        f"KI-Extraktion aus dem Gutachtentext ({ki_f:g}) ab. Der bereits "
                        f"gespeicherte Wert bleibt maßgeblich (KI überschreibt nur NULL-Felder), "
                        f"Abweichung wird zur manuellen Prüfung geloggt."
                    ),
                )
            )
    return flags


def evaluate_listing(listing: dict, ki: Optional[dict] = None) -> list[QualityFlag]:
    """
    Führt alle Plausibilitätsprüfungen für ein Listing (+ optionale
    KI-Analyse-Zeile) aus und gibt die gesammelten Flags zurück.

    `listing` erwartet u.a.: aktenzeichen, bundesland, plz, ort, kategorie,
    verkehrswert, wohnflaeche_m2, grundstuecksflaeche_m2, nutzflaeche_m2,
    gesamtflaeche_m2, baujahr, zimmer, termin_date, ist_aktiv.
    `ki` (falls vorhanden) erwartet die Spalten aus zvg_ki_analyses, u.a.
    effizienzklasse, ausweisjahr, endenergieverbrauch_kwh,
    energieausweis_vorhanden, sowie die Freitextfelder.
    """
    flags: list[QualityFlag] = []
    flags += check_flaechen(listing)
    flags += check_zimmer(listing)
    flags += check_baujahr(listing)
    flags += check_verkehrswert(listing)
    flags += check_aktenzeichen(listing)
    flags += check_termin(listing)
    flags += check_plz_ort_bundesland(listing)
    if ki:
        flags += check_energieausweis(ki)
        flags += check_ki_freitext(ki)
    return flags


def needs_review(flags: list[QualityFlag]) -> bool:
    """True, sobald mindestens ein Flag mit severity in {warning, critical} vorliegt."""
    return any(f.severity in ("warning", "critical") for f in flags)


def flags_to_json(flags: list[QualityFlag]) -> list[dict]:
    return [f.to_dict() for f in flags]
