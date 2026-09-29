"""Nominatim-Geocoding für Gavel (rate-limited: 1 req/s)."""

import asyncio
import math
import re

import httpx
from loguru import logger

from src.utils.user_agent import user_agent

# Erkennt Ortsteil-/Stadtteil-Zusätze wie "Fehrbellin OT Tarmow",
# "Gumtow GT Schönhagen" oder "Magdeburg, Stadtteil Neustädter Feld" -
# Nominatim kennt viele kleine Ortsteile nicht als eigenständigen Suchbegriff,
# die übergeordnete Gemeinde/Stadt aber fast immer.
_ORTSTEIL_PATTERN = re.compile(r"(\s+(OT|GT)\s+.+|,?\s*Stadtteil\s+.+)$", re.IGNORECASE)


MISSING_OR_NULL_ISLAND_SQL = "(lat IS NULL OR lng IS NULL OR (lat = 0 AND lng = 0))"
HAS_GEOCODEABLE_LOCATION_SQL = (
    "(NULLIF(BTRIM(adresse), '') IS NOT NULL"
    " OR NULLIF(BTRIM(plz), '') IS NOT NULL"
    " OR NULLIF(BTRIM(ort), '') IS NOT NULL)"
)


def is_usable_geo_point(lat: object, lng: object) -> bool:
    if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
        return False
    if isinstance(lat, bool) or isinstance(lng, bool):
        return False
    if not math.isfinite(lat) or not math.isfinite(lng):
        return False
    return not (lat == 0 and lng == 0)


_CITY_FOLD = str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss"})


def _location_part(value: object) -> str | None:
    text = str(value or "").strip()
    return text or None


def normalize_location_city(ort: object) -> str:
    return str(ort or "").strip().lower().translate(_CITY_FOLD)


def location_identity(
    adresse: object = None,
    plz: object = None,
    ort: object = None,
) -> tuple[str, str, str]:
    return (
        str(adresse or "").strip().lower(),
        str(plz or "").strip(),
        normalize_location_city(ort),
    )


def coherent_location(
    incoming: tuple[object, object, object] | None,
    previous: tuple[object, object, object] | None,
) -> tuple[str | None, str | None, str | None]:
    incoming = incoming or (None, None, None)
    previous = previous or (None, None, None)
    in_addr, in_plz, in_ort = (
        _location_part(incoming[0]),
        _location_part(incoming[1]),
        _location_part(incoming[2]),
    )
    prev_addr, prev_plz, prev_ort = (
        _location_part(previous[0]),
        _location_part(previous[1]),
        _location_part(previous[2]),
    )
    if in_ort is None:
        if in_plz and prev_plz and in_plz != prev_plz:
            return in_addr, in_plz, None
        return in_addr or prev_addr, in_plz or prev_plz, prev_ort
    if not prev_ort:
        if in_plz and prev_plz and in_plz != prev_plz and in_addr is None:
            return None, in_plz, in_ort
        return in_addr or prev_addr, in_plz or prev_plz, in_ort
    if normalize_location_city(in_ort) != normalize_location_city(prev_ort):
        return in_addr, in_plz, in_ort
    if in_plz and prev_plz and in_plz != prev_plz and in_addr is None:
        return None, in_plz, in_ort
    return in_addr or prev_addr, in_plz or prev_plz, in_ort


def parse_usable_geo_point(lat: object, lng: object) -> tuple[float, float] | None:
    if isinstance(lat, bool) or isinstance(lng, bool):
        return None
    try:
        parsed_lat = float(lat)  # type: ignore[arg-type]
        parsed_lng = float(lng)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    if not is_usable_geo_point(parsed_lat, parsed_lng):
        return None
    return parsed_lat, parsed_lng


def nominatim_search_query(
    adresse: str | None,
    plz: str | None = None,
    ort: str | None = None,
    *,
    country_label: str | None = "Deutschland",
) -> str:
    parts: list[str] = []
    if adresse:
        parts.append(adresse)
    elif plz or ort:
        parts.append(f"{plz or ''} {ort or ''}".strip())
    if country_label:
        parts.append(country_label)
    return ", ".join(p for p in parts if p)


async def geocode_address(
    adresse: str | None,
    plz: str | None = None,
    ort: str | None = None,
    max_retries: int = 2,
    *,
    countrycodes: str | None = "de",
    country_label: str | None = "Deutschland",
) -> tuple[float, float] | None:
    """
    Geocodiert eine Adresse via Nominatim (OpenStreetMap).

    Rate-Limit: max. 1 Anfrage/Sekunde laut Nominatim-ToS (Aufrufer ist dafür
    verantwortlich, zwischen Aufrufen ausreichend zu pausieren, siehe
    geocode_batch()/geocode_missing_listings_task()).

    Root-Cause-Fix (2026-07-04): `adresse` enthält bei den ZVG-Quellen bereits
    Straße, PLZ und Ort als ein zusammengesetzter String (z.B.
    "Harderstraße 21, 89250, Senden"). Der bisherige Code hängte PLZ/Ort dann
    ZUSÄTZLICH an ("...Senden, 89250 Senden, Deutschland") - dieses doppelte
    Vorkommen ließ Nominatim die Anfrage fast immer nicht mehr auflösen
    (kein einziges Ergebnis), wodurch faktisch nur die (ungenaueren)
    Fallback-Aufrufe mit adresse=None je funktionierten. Jetzt: `adresse`
    wird, wenn vorhanden, UNVERÄNDERT (ohne zusätzliches Anhängen von
    plz/ort) verwendet; nur wenn keine `adresse` übergeben wird, dient
    "plz ort" als eigenständige (Fallback-)Anfrage.

    ZVG-Aufrufer behalten den Default `countrycodes=de`. Custom-URL-Analysen
    übergeben None, weil Angebote auch in AT/CH liegen können.

    Returns:
        (lat, lng) als float-Tupel oder None wenn nicht gefunden.
    """
    query = nominatim_search_query(adresse, plz, ort, country_label=country_label)
    if not query:
        return None

    for attempt in range(max_retries + 1):
        try:
            params: dict[str, str | int] = {
                "q": query,
                "format": "json",
                "limit": 1,
                "addressdetails": 0,
            }
            if countrycodes:
                params["countrycodes"] = countrycodes
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    "https://nominatim.openstreetmap.org/search",
                    params=params,
                    headers={"User-Agent": user_agent()},
                )

            # Nominatim liefert bei Überlastung/Rate-Limit 403/429 - mit
            # Backoff erneut versuchen statt sofort aufzugeben (still
            # verschluckte Fehler waren Teil des ursprünglichen Bugs).
            if response.status_code in (403, 429, 503) and attempt < max_retries:
                backoff = 2.0 * (attempt + 1)
                logger.warning(
                    f"Nominatim {response.status_code} für '{query}' "
                    f"(Versuch {attempt + 1}/{max_retries + 1}) - warte {backoff}s"
                )
                await asyncio.sleep(backoff)
                continue

            response.raise_for_status()
            results = response.json()

            if results:
                lat = float(results[0]["lat"])
                lon = float(results[0]["lon"])
                if not is_usable_geo_point(lat, lon):
                    logger.debug(f"Unbrauchbare Koordinaten für: '{query}'")
                    return None
                logger.debug(f"Geocodiert: '{query}' → ({lat}, {lon})")
                return lat, lon

            logger.debug(f"Kein Ergebnis für: '{query}'")
            return None

        except (httpx.TimeoutException, httpx.TransportError) as e:
            if attempt < max_retries:
                backoff = 2.0 * (attempt + 1)
                logger.warning(
                    f"Geocoding-Timeout für '{query}' "
                    f"(Versuch {attempt + 1}/{max_retries + 1}): {e} - warte {backoff}s"
                )
                await asyncio.sleep(backoff)
                continue
            logger.warning(f"Geocoding-Fehler für '{query}' (endgültig): {e}")
            return None
        except Exception as e:
            logger.warning(f"Geocoding-Fehler für '{query}': {e}")
            return None

    return None


async def geocode_with_fallback(
    adresse: str | None,
    plz: str | None = None,
    ort: str | None = None,
    delay: float = 1.1,
    *,
    countrycodes: str | None = "de",
    country_label: str | None = "Deutschland",
) -> tuple[float, float] | None:
    """
    Geocodiert mit abgestufter Fallback-Kette (jeweils mit Rate-Limit-Pause
    dazwischen), analog zur bisherigen Logik in backfill_geocoding.py:

      1. Volle Adresse (Straße/Hausnummer/PLZ/Ort, wie gescrapt)
      2. Nur "PLZ Ort" (falls PLZ nicht anonymisiert, d.h. nicht mit "00" beginnt)
      3. Nur Ort
      4. Nur die übergeordnete Gemeinde, falls `ort` einen Ortsteil-Zusatz
         enthält (z.B. "Fehrbellin OT Tarmow" → "Fehrbellin"). Viele kleine
         Ortsteile sind in Nominatim nicht als eigener Suchbegriff bekannt,
         die Gemeinde selbst aber praktisch immer - liefert dann zwar nur
         Gemeinde-Zentrum statt exakte Position, aber einen sichtbaren Marker
         statt gar keinen.

    Damit bekommt jedes Listing mit brauchbaren Adressdaten mehrere Chancen,
    bevor es endgültig als "nicht geocodierbar" gilt.
    """
    scope = {"countrycodes": countrycodes, "country_label": country_label}
    coords = await geocode_address(adresse=adresse, plz=plz, ort=ort, **scope)

    if coords is None and ort and plz and not plz.startswith("00"):
        await asyncio.sleep(delay)
        coords = await geocode_address(adresse=None, plz=plz, ort=ort, **scope)

    if coords is None and ort:
        await asyncio.sleep(delay)
        coords = await geocode_address(adresse=ort, **scope)

    if coords is None and ort and _ORTSTEIL_PATTERN.search(ort):
        gemeinde = _ORTSTEIL_PATTERN.sub("", ort).strip()
        if gemeinde:
            await asyncio.sleep(delay)
            coords = await geocode_address(adresse=gemeinde, **scope)

    return coords


async def geocode_batch(
    addresses: list[dict],
    delay: float = 1.1,
) -> list[tuple[float, float] | None]:
    """
    Geocodiert eine Liste von Adressen sequentiell mit Rate-Limiting.

    Args:
        addresses: Liste von Dicts mit keys: adresse, plz (optional), ort (optional)
        delay: Pause zwischen Anfragen in Sekunden (min. 1.0 laut Nominatim-ToS)

    Returns:
        Liste von (lat, lng)-Tupeln oder None-Werten (gleiche Reihenfolge).
    """
    results = []
    for i, addr in enumerate(addresses):
        if i > 0:
            await asyncio.sleep(delay)
        result = await geocode_address(
            adresse=addr.get("adresse", ""),
            plz=addr.get("plz"),
            ort=addr.get("ort"),
        )
        results.append(result)
    return results
