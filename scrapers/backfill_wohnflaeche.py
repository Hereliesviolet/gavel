#!/usr/bin/env python3
"""
Backfill: Wohnflaeche aus Gutachten -> zvg_listings.wohnflaeche_m2

Gezielte Nachextraktion fuer Haus-/Wohnungsobjekte mit gutachten_url, deren
wohnflaeche_m2 fehlt. Ohne Wohnflaeche ist kein EUR/m2 rechenbar und damit
weder Marktluecke noch Peer-Vergleich.

Drei Stufen, absichtlich in dieser Reihenfolge:
  1. Regex ueber den vollstaendigen Gutachtentext. Nur wenn alle Fundstellen
     denselben Wert nennen, wird er uebernommen - ein Gutachten mit mehreren
     Teilobjekten nennt mehrere Flaechen, und die falsche waere schlimmer
     als keine.
  2. Text-LLM, wenn eine brauchbare Textebene da ist, die Regex aber uneindeutig.
  3. Vision auf gerenderten Seiten, wenn das PDF ein Scan ohne Textebene ist.
     Das ist bei rund drei Vierteln der Gutachten der Fall. Seiten werden in
     Bloecken nachgeschoben, bis der Wert gefunden ist oder das Seitenbudget
     erschoepft ist.

Ausfuehrung:
  docker exec gavel_scraper python /app/backfill_wohnflaeche.py [--limit 50] [--dry-run]
"""

import argparse
import asyncio
import io
import os
import re
import sys
from typing import Optional

import asyncpg
import pdfplumber
from loguru import logger

SCRAPER_ROOT = os.path.dirname(os.path.abspath(__file__))
if SCRAPER_ROOT not in sys.path:
    sys.path.insert(0, SCRAPER_ROOT)

from src.storage.minio import download_gutachten_pdf
from src.utils.pdf_vision import frage_an_seiten, rendere_seiten, seiten_anzahl

MIN_M2 = 15.0
MAX_M2 = 2000.0
TEXTEBENE_AB = 3000
SEITEN_JE_BLOCK = 8
SEITEN_BUDGET = 24
TERMINAL_WOHNFLAECHE_SKIPS = frozenset(
    {"gutachten_kostenpflichtig", "scan_ohne_befund", "kein_pdf"}
)

_ZAHL = r"([0-9]{1,4}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?)\s*(?:m²|m2|qm|m\s*²)"

# Gutachten nennen die Wohnflaeche oft mehrfach: je Einheit, als Summe und in
# Mietertragstabellen. Die Summenzeile ist die einzige Fundstelle, die auch bei
# mehreren Einheiten das ganze Objekt meint, deshalb hat sie Vorrang.
_WOHNFLAECHE_SUMME = re.compile(
    r"(?:Summe\s+(?:der\s+)?Wohnfl(?:ä|ae|a)chen?|"
    r"Gesamtwohnfl(?:ä|ae|a)che|"
    r"Wohnfl(?:ä|ae|a)che\s+(?:gesamt|insgesamt))"
    r"[^0-9\n]{0,20}" + _ZAHL,
    re.IGNORECASE,
)

# Direkte Nennung ohne Tabellenrauschen: hoechstens ein kurzes Fuellwort
# zwischen Begriff und Zahl, sonst greift der Ausdruck quer durch Tabellen.
_WOHNFLAECHE_DIREKT = re.compile(
    r"Wohnfl(?:ä|ae|a)che\s*(?:von|beträgt|betraegt|:|ca\.|rd\.|etwa)?\s{0,3}" + _ZAHL,
    re.IGNORECASE,
)

_WOHNFLAECHE_ERWAEHNT = re.compile(r"Wohnfl(?:ä|ae|a)che", re.IGNORECASE)

# Die meisten Bekanntmachungen verweisen auf ein kostenpflichtiges Gutachten.
# Dort steht die Wohnflaeche nicht und wird auch nie dort stehen — solche
# Dokumente durch das Vision-Modell zu schicken kostet nur Geld.
_KOSTENPFLICHTIG = re.compile(
    r"kostenpflichtig|gegen\s+(?:eine\s+)?(?:Geb(?:ü|ue)hr|Kostenerstattung)"
    r"|Gutachten\s+kann\s+.{0,40}angefordert",
    re.IGNORECASE,
)
_ANTWORT_ZAHL = re.compile(r"([0-9]{1,4}(?:[.,][0-9]{1,2})?)")

VISION_FRAGE = (
    "Diese Seiten stammen aus einem Verkehrswertgutachten fuer eine "
    "Zwangsversteigerung. Nenne die Wohnflaeche des bewerteten Objekts in "
    "Quadratmetern. Bei mehreren Wohneinheiten im selben Objekt nenne die "
    "Summe der Wohnflaechen. Antworte ausschliesslich mit der Zahl "
    "(Dezimaltrennzeichen Komma) oder mit UNBEKANNT. Antworte UNBEKANNT, wenn "
    "die Seiten keine Wohnflaeche nennen, wenn nur Grundstuecks- oder "
    "Nutzflaeche genannt wird, oder wenn getrennte Objekte beschrieben werden "
    "und die Zuordnung unklar ist. Rate nicht und rechne nichts hoch."
)


def _zahl(text: str) -> Optional[float]:
    try:
        return float(text.replace(".", "").replace(",", "."))
    except ValueError:
        return None


def _plausibel(wert: Optional[float]) -> Optional[float]:
    if wert is None or not (MIN_M2 <= wert <= MAX_M2):
        return None
    return round(wert, 1)


def _eindeutig(muster: re.Pattern[str], text: str) -> Optional[float]:
    werte = {_plausibel(_zahl(treffer.group(1))) for treffer in muster.finditer(text)}
    werte.discard(None)
    return werte.pop() if len(werte) == 1 else None


def wohnflaeche_aus_text(text: str) -> Optional[float]:
    """Liefert die Wohnflaeche nur bei eindeutigem Befund, sonst None."""
    return _eindeutig(_WOHNFLAECHE_SUMME, text) or _eindeutig(_WOHNFLAECHE_DIREKT, text)


def volltext(pdf_bytes: bytes) -> str:
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            return "\n".join((seite.extract_text() or "") for seite in pdf.pages)
    except Exception as exc:
        logger.warning(f"Textextraktion fehlgeschlagen: {exc}")
        return ""


async def lade_pdf(url: str) -> Optional[bytes]:
    try:
        return await download_gutachten_pdf(url, referer="https://zvg.com/")
    except Exception as exc:
        logger.warning(f"Gutachten-Download fehlgeschlagen ({url}): {exc}")
        return None


def teilobjekt_hinweis(listing: dict) -> str:
    anteil = " ".join(
        str(listing.get(feld) or "") for feld in ("miteigentumsanteil", "sondereigentum")
    ).strip()
    if not anteil:
        return ""
    return (
        f"\n\nAchtung Teilobjekt: Das Verfahren betrifft nur '{anteil}'. "
        "Nenne nur dessen Wohnflaeche, sonst UNBEKANNT."
    )


def aus_vision(pdf_bytes: bytes, listing: dict, budget: int = SEITEN_BUDGET) -> Optional[float]:
    from src.flows.ki_analysis import get_langdock_client

    client, model = get_langdock_client()
    frage = VISION_FRAGE + teilobjekt_hinweis(listing)
    gesamt = min(seiten_anzahl(pdf_bytes), budget)

    for start in range(0, gesamt, SEITEN_JE_BLOCK):
        bilder = rendere_seiten(pdf_bytes, start, start + SEITEN_JE_BLOCK)
        antwort = frage_an_seiten(client.client, model, bilder, frage)
        if not antwort or "UNBEKANNT" in antwort.upper():
            continue
        treffer = _ANTWORT_ZAHL.search(antwort)
        if treffer:
            wert = _plausibel(_zahl(treffer.group(1)))
            if wert is not None:
                return wert
    return None


def aus_text_llm(text: str, listing: dict) -> Optional[float]:
    from src.flows.ki_analysis import get_langdock_client

    client, model = get_langdock_client()
    frage = (
        "Ermittle aus diesem Verkehrswertgutachten die Wohnflaeche des zu "
        "versteigernden Objekts in Quadratmetern. Bei mehreren Wohneinheiten "
        "im selben Objekt nenne die Summe der Wohnflaechen. Nutzflaeche, "
        "Grundstuecksflaeche und Bruttogrundflaeche zaehlen nicht mit. "
        "Antworte ausschliesslich mit der Zahl oder mit UNBEKANNT, wenn das "
        "Dokument keine Wohnflaeche nennt. Rate nicht und rechne nichts hoch."
        + teilobjekt_hinweis(listing)
        + f"\n\n---\n{text[:40000]}"
    )
    try:
        antwort = (
            client.client.messages.create(
                model=model,
                max_tokens=200,
                messages=[{"role": "user", "content": frage}],
            )
            .content[0]
            .text
        )
    except Exception as exc:
        logger.warning(f"Text-LLM fehlgeschlagen: {exc}")
        return None
    if "UNBEKANNT" in antwort.upper():
        return None
    treffer = _ANTWORT_ZAHL.search(antwort)
    return _plausibel(_zahl(treffer.group(1))) if treffer else None


async def kandidaten(conn: asyncpg.Connection, limit: int) -> list[dict]:
    rows = await conn.fetch(
        """
        SELECT id, aktenzeichen, kategorie, gutachten_url,
               miteigentumsanteil, sondereigentum
        FROM zvg_listings
        WHERE ist_aktiv
          AND wohnflaeche_m2 IS NULL
          AND gutachten_url IS NOT NULL
          AND kategorie IN ('haus', 'wohnung')
          AND COALESCE(raw_data->>'wohnflaeche_skip', '') = ''
        ORDER BY termin_date NULLS LAST
        LIMIT $1
        """,
        limit,
    )
    return [dict(r) for r in rows]


async def verarbeite(listing: dict, kein_llm: bool, budget: int) -> tuple[Optional[float], str]:
    pdf_bytes = await lade_pdf(listing["gutachten_url"])
    if not pdf_bytes:
        return None, "kein_pdf"

    text = await asyncio.to_thread(volltext, pdf_bytes)
    wert = wohnflaeche_aus_text(text)
    if wert is not None:
        return wert, "regex"
    if kein_llm:
        return None, "uneindeutig"

    if _KOSTENPFLICHTIG.search(text) and not _WOHNFLAECHE_ERWAEHNT.search(text):
        return None, "gutachten_kostenpflichtig"

    if len(text) >= TEXTEBENE_AB or _WOHNFLAECHE_ERWAEHNT.search(text):
        wert = await asyncio.to_thread(aus_text_llm, text, listing)
        if wert is not None:
            return wert, "text_llm"
        return None, "uneindeutig"

    wert = await asyncio.to_thread(aus_vision, pdf_bytes, listing, budget)
    if wert is not None:
        return wert, "vision"
    return None, "scan_ohne_befund"


async def main() -> None:
    parser = argparse.ArgumentParser(description="Wohnflaeche aus Gutachten nachextrahieren")
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--kein-llm", action="store_true", help="Nur Regex, keine LLM-Kosten")
    parser.add_argument(
        "--seiten-budget",
        type=int,
        default=SEITEN_BUDGET,
        help="Maximal gerenderte Seiten je Scan-Gutachten",
    )
    args = parser.parse_args()

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        logger.error("DATABASE_URL nicht gesetzt")
        sys.exit(1)

    conn = await asyncpg.connect(database_url)
    try:
        objekte = await kandidaten(conn, args.limit)
        logger.info(f"{len(objekte)} Objekte ohne Wohnflaeche mit Gutachten")

        zaehler: dict[str, int] = {}
        for i, listing in enumerate(objekte, 1):
            try:
                wert, quelle = await verarbeite(listing, args.kein_llm, args.seiten_budget)
            except Exception as exc:
                logger.error(f"[{i}/{len(objekte)}] {listing['aktenzeichen']}: {exc}")
                zaehler["fehler"] = zaehler.get("fehler", 0) + 1
                continue

            zaehler[quelle] = zaehler.get(quelle, 0) + 1
            if wert is None:
                logger.info(f"[{i}/{len(objekte)}] {listing['aktenzeichen']}: {quelle}")
                if quelle in TERMINAL_WOHNFLAECHE_SKIPS and not args.dry_run:
                    await conn.execute(
                        """
                        UPDATE zvg_listings
                        SET raw_data = COALESCE(raw_data, '{}'::jsonb)
                          || jsonb_build_object('wohnflaeche_skip', $2::text),
                            updated_at = now()
                        WHERE id = $1
                        """,
                        listing["id"],
                        quelle,
                    )
                continue

            logger.info(f"[{i}/{len(objekte)}] {listing['aktenzeichen']}: {wert} m2 ({quelle})")
            if not args.dry_run:
                await conn.execute(
                    """
                    UPDATE zvg_listings
                    SET wohnflaeche_m2 = $2,
                        raw_data = COALESCE(raw_data, '{}'::jsonb) - 'wohnflaeche_skip',
                        updated_at = now()
                    WHERE id = $1
                    """,
                    listing["id"],
                    wert,
                )

        zusammenfassung = ", ".join(f"{k}={v}" for k, v in sorted(zaehler.items()))
        logger.info(
            f"Fertig: {zusammenfassung}"
            + (" (dry-run, nichts geschrieben)" if args.dry_run else "")
        )
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
