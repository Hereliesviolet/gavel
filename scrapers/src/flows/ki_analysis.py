"""
Prefect Flow: KI-Analyse neuer ZVG-Listings via Langdock
Daily schreibt nur die Basis-Extraktion (Haiku). Die Vollanalyse
(Investment/Fix&Flip) startet der User auf der Detailseite.

Gutachten-Unterstützung:
  Wenn ein Listing eine gutachten_url hat, wird das PDF heruntergeladen,
  Text per pdfplumber extrahiert und dem KI-Prompt beigefügt.
"""

import asyncio
import io
import json
import os
from datetime import datetime
from typing import Optional

import asyncpg
import httpx
import instructor
import pdfplumber
from anthropic import Anthropic
from loguru import logger
from prefect import flow, task, get_run_logger

from src.models.zvg import (
    FixFlipDealSchaetzung,
    FixFlipMassnahme,
    InvestmentEnrichmentResult,
    KIBasicAnalyseResult,
    KIFactExtractResult,
    OrtInDerNaehe,
)
from src.utils.geocoding import parse_usable_geo_point
from src.storage.minio import download_gutachten_pdf
from src.storage.postgres import (
    upsert_ki_analyse,
    get_ki_analysis_status,
    set_full_analysis_status,
    update_listing_grunddaten,
    update_data_quality_flags,
    get_listing_for_quality_check,
    get_listings_for_fix_flip_deal_reanalysis,
    mark_ki_analysis_schema_current,
    update_auction_terms,
    update_fix_flip_deal,
    update_investment_enrichment,
)
from src.utils.terminsbestimmung import parse_terminsbestimmung
from src.utils.analysis_run_lock import hold_heavy_run_lock, try_analysis_run_lock
from src.utils.analysis_version import ANALYSIS_SCHEMA_VERSION
from src.utils.data_quality import (
    evaluate_listing,
    cross_validate_ki_result,
    needs_review,
    flags_to_json,
)

from src.utils.ki_context import build_analysis_context
from src.utils.ki_tiers import should_skip_basic_for_status


INVESTMENT_PROMPT_LIVE_AFTER = datetime(2026, 7, 8, 16, 16)

_INVESTMENT_ENRICHMENT_INSTRUCTIONS = (
    "WICHTIG für investment_score/risiken_investor: Bewerte zusätzlich aus "
    "reiner Investorensicht, ob sich das Objekt als Kapitalanlage eignet "
    "(investment_score + kurze Begründung) und liste konkrete "
    "Investitionsrisiken auf (Sanierungsstau, Vermietbarkeit, Lagerisiko, "
    "Rechtsrisiken/Baulasten, Klumpenrisiko, ...) - getrennt von den bereits "
    "erfassten Mängeln/Zustandsangaben.\n\n"
    "WICHTIG für fix_flip_massnahmen: Leite konkrete Sanierungsmaßnahmen mit "
    "Kostenschätzung AUS den Angaben zu maengel, modernisierungen, "
    "zustand_aussen, zustand_innen und baubeschreibung ab. Führe Maßnahmen nur "
    "bei dort belegtem Sanierungsbedarf auf und bleibe konsistent zu den "
    "Bestandsdaten. fix_flip_werteinschaetzung: 2-3 Sätze, KEINE konkrete "
    "ARV-Zahl (After-Repair-Value) ohne Vergleichsobjekt-Datenbasis."
)

_ENRICHMENT_ANALYSIS_FIELDS = (
    "maengel",
    "belastungen",
    "modernisierungen",
    "energieausweis_vorhanden",
    "effizienzklasse",
    "ausweisjahr",
    "energietraeger",
    "endenergieverbrauch_kwh",
    "innenbesichtigung",
    "restnutzungsdauer_j",
    "heizung",
    "wohnraeume",
    "zustand_aussen",
    "zustand_innen",
    "maengel_kurz",
    "baubeschreibung",
    "instandhaltung",
    "baulasten",
    "lage_einwohner",
    "lage_region",
    "lage_verkehr",
    "lage_charakter",
    "lage_umgebung",
    "moegliche_kaltmiete",
    "hausgeld",
    "jahresrohertrag",
    "liegenschaftszinssatz",
    "ertragswert",
)

_ENRICHMENT_LISTING_FIELDS = (
    "aktenzeichen",
    "typ",
    "kategorie",
    "verkehrswert",
    "beschreibung",
    "plz",
    "ort",
    "bundesland",
    "wohnflaeche_m2",
    "grundstuecksflaeche_m2",
    "nutzflaeche_m2",
    "gesamtflaeche_m2",
    "zimmer",
    "baujahr",
    "termin_date",
)

_RENOVATION_EVIDENCE_TERMS = (
    "sanierungsbed",
    "renovierungsbed",
    "modernisierungsbedarf",
    "instandsetzungsbedarf",
    "erneuerungsbed",
    "reparatur",
    "mangel",
    "mängel",
    "schaden",
    "schäden",
    "beschädigt",
    "undicht",
    "feucht",
    "schimmel",
    "riss",
    "abgenutzt",
    "defekt",
    "restarbeiten",
    "vernachlässigt",
    "verschleiß",
    "verschlissen",
    "abbruchreif",
    "desolat",
    "ungepflegt",
    "unterlassene instandhaltung",
)


def _create_with_token_usage(client: instructor.Instructor, **kwargs):
    result, completion = client.messages.create_with_completion(**kwargs)
    usage = getattr(completion, "usage", None)
    input_tokens = int(getattr(usage, "input_tokens", 0) or 0)
    output_tokens = int(getattr(usage, "output_tokens", 0) or 0)
    return result, input_tokens, output_tokens


def _existing_analysis(listing: dict) -> dict:
    raw = listing.get("existing_analysis")
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except (TypeError, ValueError):
            return {}
    return {}


def build_investment_enrichment_context(listing: dict) -> str:
    existing = _existing_analysis(listing)
    listing_data = {
        key: listing.get(key)
        for key in _ENRICHMENT_LISTING_FIELDS
        if listing.get(key) not in (None, "")
    }
    analysis_data = {
        key: existing.get(key)
        for key in _ENRICHMENT_ANALYSIS_FIELDS
        if existing.get(key) not in (None, "")
    }
    return json.dumps(
        {
            "objekt": listing_data,
            "bereits_extrahierte_gutachtendaten": analysis_data,
            "dokumentierter_sanierungsbedarf": has_documented_renovation_need(listing),
        },
        ensure_ascii=False,
        default=str,
    )


def _analysis_has_renovation_evidence(analysis: dict) -> bool:
    """Prüft strukturierte Analyse-Felder auf dokumentierten Renovierungsbedarf
    (gemeinsame Evidenz-Logik für Full-Analyse und Enrichment)."""
    maengel_text = " ".join(
        str(item.get("beschreibung") or "").lower()
        for item in (analysis.get("maengel") or [])
        if isinstance(item, dict)
    )
    condition_text = (
        maengel_text
        + " "
        + " ".join(
            str(analysis.get(key) or "").lower()
            for key in ("zustand_aussen", "zustand_innen", "maengel_kurz", "instandhaltung")
        )
    )
    for negation in (
        "keine mängel",
        "kein mangel",
        "ohne mängel",
        "keine schäden",
        "kein schaden",
        "ohne schäden",
        "kein sanierungsbedarf",
        "kein renovierungsbedarf",
    ):
        condition_text = condition_text.replace(negation, "")
    return any(term in condition_text for term in _RENOVATION_EVIDENCE_TERMS)


def has_documented_renovation_need(
    listing: dict,
    analysis: dict | None = None,
) -> bool:
    """True, wenn Bestands- und/oder frische Analyse-Felder Renovierungsbedarf
    belegen. `analysis` optional — bei Full-Analyse das frische KI-Ergebnis
    übergeben (Enrichment nutzt nur existing_analysis im listing)."""
    existing = _existing_analysis(listing)
    if analysis:
        merged = {
            **existing,
            **{k: v for k, v in analysis.items() if v not in (None, "", [])},
        }
    else:
        merged = existing
    return _analysis_has_renovation_evidence(merged)


def run_investment_enrichment(
    client: instructor.Instructor,
    model: str,
    listing: dict,
) -> tuple[InvestmentEnrichmentResult, int, int]:
    context = build_investment_enrichment_context(listing)
    return _create_with_token_usage(
        client,
        model=model,
        max_tokens=3072,
        response_model=InvestmentEnrichmentResult,
        messages=[
            {
                "role": "user",
                "content": (
                    "Ergänze die bestehende strukturierte Gutachtenanalyse ausschließlich "
                    "um Investment- und Fix&Flip-Felder. Extrahiere die Grunddaten nicht neu "
                    "und erfinde keine Informationen außerhalb der Bestandsdaten. Alter/Baujahr, "
                    "eine fehlende Innenbesichtigung, fehlende Modernisierungsangaben, allgemeine "
                    "energetische Standards sowie vorsorgliche Prüfungen sind KEIN belegter "
                    "Sanierungsbedarf. Setze fix_flip_massnahmen in diesen Fällen auf eine leere "
                    "Liste. Formuliere keine Maßnahmen mit 'prüfen', 'gegebenenfalls' oder "
                    "typischen Altersannahmen.\n\n"
                    f"{_INVESTMENT_ENRICHMENT_INSTRUCTIONS}\n\n"
                    f"STRUKTURIERTE BESTANDSDATEN:\n{context}"
                ),
            }
        ],
    )


def build_teilobjekt_hinweis(listing: dict) -> str:
    """
    Baut einen Kontext-Hinweis für den KI-Prompt, der verhindert, dass bei
    Zwangsversteigerungen mit mehreren Teilobjekten (z.B. Wohnhaus + separat
    verwertete Hoffläche/Stellplatz/Garage, erkennbar an Aktenzeichen-Suffix
    "#1", "#2", ...) Flächen- und Beschreibungsdaten des FALSCHEN Teilobjekts
    übernommen werden.

    Hintergrund (Untersuchung 2026-07-04, Objekt 3-k-11-25-1-hanmark-weissenhorn):
    Hanmark veröffentlicht bei solchen Fällen pro Teilobjekt eine eigene Wertgutachten-
    Seite mit eigenem, korrektem Verkehrswert – das zugehörige Gutachten-PDF beschreibt
    aber oft ALLE Teilobjekte der Versteigerung gemeinsam (z.B. "Verkehrswert Hoffläche
    ... 5.000 EUR" UND "Verkehrswert Wohnhaus BV 3 ... 280.000 EUR" im selben PDF). Ohne
    diesen Hinweis hat die KI in der Vergangenheit Wohnfläche/Grundstücksfläche/
    Beschreibung des jeweils ANDEREN (meist größeren) Teilobjekts übernommen, obwohl der
    gespeicherte Verkehrswert korrekt für dieses Teilobjekt war – das erzeugte den
    fälschlichen Eindruck eines Verkehrswert-Parsing-Fehlers.
    """
    typ = listing.get("typ") or "unbekannt"
    az = listing.get("aktenzeichen") or ""
    vw = listing.get("verkehrswert")
    vw_str = f"{int(vw):,} EUR".replace(",", ".") if vw else "unbekannt"

    return (
        "WICHTIGER KONTEXT ZU DIESEM DATENSATZ:\n"
        f"- Aktenzeichen: {az}\n"
        f"- Objekttyp laut Quelle: {typ}\n"
        f"- Amtlicher Verkehrswert laut Quelle für GENAU DIESES Teilobjekt: {vw_str}\n\n"
        "Falls das nachfolgende Gutachten MEHRERE Teilobjekte / Bestandsverzeichnis-"
        "(BV-)Positionen beschreibt (z.B. weil eine Zwangsversteigerung in mehrere Lose "
        "aufgeteilt ist – erkennbar u.a. an einem '#'-Suffix im Aktenzeichen oder an "
        "mehreren getrennt genannten Verkehrswerten pro BV-Nummer im Gutachten):\n"
        "  1. Ermittle anhand des oben genannten Verkehrswerts und Objekttyps, welche "
        "BV-Position/welches Teilobjekt im Gutachten zu DIESEM Datensatz gehört.\n"
        "  2. Extrahiere wohnflaeche_m2, grundstuecksflaeche_m2, zimmer, baujahr und "
        "beschreibung AUSSCHLIESSLICH für dieses eine Teilobjekt – NICHT für andere im "
        "selben Gutachten mitbeschriebene Teilobjekte.\n"
        "  3. Falls du die Zuordnung nicht mit ausreichender Sicherheit vornehmen kannst, "
        "setze wohnflaeche_m2, grundstuecksflaeche_m2 und beschreibung auf null, statt "
        "Daten eines möglicherweise falschen Teilobjekts zu übernehmen.\n"
    )


DEFAULT_EXTRACT_MODEL = "claude-haiku-4-5-default"
DEFAULT_INVEST_MODEL = "claude-sonnet-4-6-default"


def langdock_extract_model() -> str:
    return os.environ.get("LANGDOCK_EXTRACT_MODEL", DEFAULT_EXTRACT_MODEL)


def langdock_invest_model() -> str:
    return os.environ.get("LANGDOCK_MODEL", DEFAULT_INVEST_MODEL)


def get_langdock_client():
    """Erstellt einen Instructor-Client via Langdock Anthropic-Endpoint."""
    api_key = os.environ["LANGDOCK_API_KEY"]
    base_url = os.environ.get("LANGDOCK_BASE_URL", "https://api.langdock.com/anthropic/eu/")

    anthropic_client = Anthropic(
        api_key=api_key,
        base_url=base_url,
    )
    return instructor.from_anthropic(anthropic_client), langdock_invest_model()


def extract_pdf_text(pdf_bytes: bytes, head_chars: int = 25000, tail_chars: int = 5000) -> str:
    """Extrahiert Text aus einem PDF via pdfplumber.

    Liefert die ersten `head_chars` Zeichen (enthält Sachverhalt, Gebäudebeschreibung)
    plus die letzten `tail_chars` Zeichen (Zusammenfassungstabellen, Verkehrswert-Übersicht).
    """
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            pages_text = []
            for page in pdf.pages:
                text = page.extract_text()
                if text:
                    pages_text.append(text)
            full_text = "\n\n".join(pages_text)

        if not full_text:
            return ""

        total = len(full_text)
        if total <= head_chars + tail_chars:
            return full_text

        head = full_text[:head_chars]
        tail = full_text[max(head_chars, total - tail_chars) :]
        if tail:
            return head + "\n\n[...]\n\n" + tail
        return head
    except Exception as e:
        logger.warning(f"PDF-Textextraktion fehlgeschlagen: {e}")
        return ""


async def download_pdf_text(pdf_url: str) -> str:
    """
    Lädt ein PDF (Gutachten oder Exposé) und extrahiert den Text via
    httpx-Download + pdfplumber (siehe docs/CUSTOM_URL_ANALYSIS.md - der
    frühere Firecrawl-PDF-Parser-Primärpfad wurde ersatzlos entfernt,
    pdfplumber ist jetzt der einzige Pfad).
    """
    if not pdf_url:
        return ""

    return await _download_pdf_text_pdfplumber(pdf_url)


async def _download_pdf_text_pdfplumber(gutachten_url: str) -> str:
    if not gutachten_url:
        return ""
    try:
        data = await download_gutachten_pdf(gutachten_url)
        if not data:
            return ""
        return await asyncio.to_thread(extract_pdf_text, data)
    except Exception as e:
        logger.warning(f"Gutachten-Download für KI fehlgeschlagen ({gutachten_url}): {e}")
        return ""


def _sum_fix_flip_kosten(massnahmen: list[FixFlipMassnahme]) -> tuple[Optional[int], Optional[int]]:
    """Summiert die Fix&Flip-Einzelmaßnahmen SERVERSEITIG (NICHT von der KI
    selbst addieren lassen, um Rechenfehler auszuschließen). Maßnahmen ohne
    Kostenangabe werden bei der jeweiligen Summe ausgelassen; gibt es gar
    keine bezifferten Maßnahmen, wird None (statt 0) zurückgegeben."""
    mins = [m.kosten_min_eur for m in massnahmen if m.kosten_min_eur is not None]
    maxs = [m.kosten_max_eur for m in massnahmen if m.kosten_max_eur is not None]
    return (sum(mins) if mins else None, sum(maxs) if maxs else None)


def _build_fix_flip_arv_prompt(
    listing: dict,
    massnahmen: list[FixFlipMassnahme],
    fix_flip_min: Optional[int],
    fix_flip_max: Optional[int],
) -> str:
    massnahmen_json = json.dumps([m.model_dump() for m in massnahmen], ensure_ascii=False)
    return (
        "Schätze den Verkaufswert NACH Sanierung (After-Repair-Value, ARV) für "
        "folgendes Zwangsversteigerungs-Objekt, das aktuell die unten genannten "
        "Sanierungsmaßnahmen benötigt. Berücksichtige Lage, Größe, Zustand NACH "
        "Sanierung und übliche Marktpreise/m² in der Region. Sei transparent, "
        "wenn die Schätzung unsicher ist (arv_konfidenz) - erfinde keine "
        "Vergleichspreise, die du nicht seriös begründen kannst.\n\n"
        f"Verkehrswert (IST-Zustand): {listing.get('verkehrswert')} EUR\n"
        f"Wohnfläche: {listing.get('wohnflaeche_m2')} m²\n"
        f"Ort: {listing.get('ort')}, PLZ: {listing.get('plz')}\n"
        f"Baujahr: {listing.get('baujahr')}\n"
        f"Objekttyp: {listing.get('typ')}\n"
        f"Geplante Sanierungsmaßnahmen: {massnahmen_json}\n"
        f"Geschätzte Sanierungskosten gesamt: {fix_flip_min} – {fix_flip_max} EUR\n"
    )


def _estimate_fix_flip_arv(
    client: instructor.Instructor,
    model: str,
    listing: dict,
    massnahmen: list[FixFlipMassnahme],
    fix_flip_min: Optional[int],
    fix_flip_max: Optional[int],
) -> tuple[FixFlipDealSchaetzung, int, int]:
    """Zweiter, kleiner LLM-Call (Ziel 6) - schätzt NUR ARV/Haltezeit/
    Konfidenz. NUR aufgerufen, wenn fix_flip_massnahmen nicht leer ist
    (siehe analyze_listing) - spart Kosten/Latenz bei Objekten ohne
    Sanierungsbedarf."""
    return _create_with_token_usage(
        client,
        model=model,
        max_tokens=1024,
        response_model=FixFlipDealSchaetzung,
        messages=[
            {
                "role": "user",
                "content": _build_fix_flip_arv_prompt(
                    listing, massnahmen, fix_flip_min, fix_flip_max
                ),
            }
        ],
    )


def _berechne_fix_flip_deal_felder(
    listing: dict,
    fix_flip_min: Optional[int],
    fix_flip_max: Optional[int],
    arv: FixFlipDealSchaetzung,
) -> dict:
    """Übernimmt nur noch die geschätzten Fakten aus dem LLM-Call.

    Gewinn, ROI und Opportunity-Score wurden hier früher in Euro ausgerechnet
    und gespeichert — mit dem vollen Verkehrswert als Kaufpreis, während das
    Web mit einem Referenzgebot rechnete. Dasselbe Objekt konnte deshalb
    gleichzeitig "attraktive Fix&Flip-Chance" und negatives Underwriting
    zeigen. Gerechnet wird jetzt ausschließlich in apps/web/lib/underwriting,
    beim Lesen und gegen das aktuelle Investorenprofil.
    """
    if not listing.get("verkehrswert"):
        return {}
    return {
        "arv_min_eur": arv.arv_min_eur,
        "arv_max_eur": arv.arv_max_eur,
        "arv_begruendung": arv.arv_begruendung,
        "arv_konfidenz": arv.arv_konfidenz,
        "holding_monate": arv.holding_monate,
    }


def estimate_and_calc_fix_flip_deal(
    client: instructor.Instructor,
    model: str,
    listing: dict,
    massnahmen: list[FixFlipMassnahme],
    fix_flip_min: Optional[int],
    fix_flip_max: Optional[int],
) -> dict:
    """Kombiniert LLM-ARV-Schätzung + serverseitige Kalkulation. NUR
    aufrufen, wenn massnahmen nicht leer ist (siehe analyze_listing +
    reanalyze_fix_flip_deal). Gibt bei Fehler ein leeres dict zurück (die
    bereits gespeicherten fix_flip_massnahmen/-kosten bleiben davon
    unberührt - kein Absturz der gesamten Analyse wegen des ARV-Calls)."""
    fields, _, _ = estimate_and_calc_fix_flip_deal_with_usage(
        client, model, listing, massnahmen, fix_flip_min, fix_flip_max
    )
    return fields


def estimate_and_calc_fix_flip_deal_with_usage(
    client: instructor.Instructor,
    model: str,
    listing: dict,
    massnahmen: list[FixFlipMassnahme],
    fix_flip_min: Optional[int],
    fix_flip_max: Optional[int],
) -> tuple[dict, int, int]:
    arv, input_tokens, output_tokens = _estimate_fix_flip_arv(
        client, model, listing, massnahmen, fix_flip_min, fix_flip_max
    )
    fields = _berechne_fix_flip_deal_felder(listing, fix_flip_min, fix_flip_max, arv)
    if arv.arv_begruendung:
        fields["fix_flip_werteinschaetzung"] = arv.arv_begruendung
    return fields, input_tokens, output_tokens


async def get_listings_without_ki(
    limit: int = 50,
    source_filter: Optional[str] = None,
    exclude_ids: Optional[list[str]] = None,
) -> list[dict]:
    """Holt Listings ohne KI-Analyse aus der DB (inkl. gutachten_url + expose_url)."""
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    try:
        where = [
            "k.id IS NULL",
            "l.ist_aktiv = TRUE",
            "l.scrape_completed_at IS NOT NULL",
            "("
            "(l.beschreibung IS NOT NULL AND length(l.beschreibung) > 50)"
            " OR l.gutachten_url IS NOT NULL"
            " OR l.expose_url IS NOT NULL"
            ")",
        ]
        params: list = [limit]
        if source_filter:
            params.append(source_filter)
            where.append(f"l.source = ${len(params)}")
        if exclude_ids:
            params.append(exclude_ids)
            where.append(f"l.id <> ALL(${len(params)}::uuid[])")
        rows = await conn.fetch(
            f"""
            SELECT l.id, l.aktenzeichen, l.typ, l.kategorie, l.verkehrswert, l.beschreibung,
                   l.lat, l.lng, l.gutachten_url, l.expose_url,
                   l.plz, l.ort, l.bundesland, l.source, l.ist_aktiv, l.termin_date,
                   l.wohnflaeche_m2, l.grundstuecksflaeche_m2, l.nutzflaeche_m2,
                   l.gesamtflaeche_m2, l.zimmer, l.baujahr
            FROM zvg_listings l
            LEFT JOIN zvg_ki_analyses k ON k.listing_id = l.id
            WHERE {" AND ".join(where)}
            ORDER BY l.created_at DESC
            LIMIT $1
            """,
            *params,
        )
        return [dict(r) for r in rows]
    finally:
        await conn.close()


async def get_listing_for_ki(listing_id: str) -> Optional[dict]:
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    try:
        row = await conn.fetchrow(
            f"""
            SELECT {_ZVG_CANDIDATE_COLUMNS}
            FROM zvg_listings l
            LEFT JOIN zvg_ki_analyses k ON k.listing_id = l.id
            WHERE l.id = $1::uuid
            """,
            listing_id,
        )
        if not row:
            return None
        item = dict(row)
        item["existing_analysis"] = _existing_analysis(item)
        return item
    finally:
        await conn.close()


async def run_requested_full_analysis(listing_id: str) -> bool:
    listing = await get_listing_for_ki(listing_id)
    if not listing:
        logger.warning(f"Vollanalyse ohne Listing: {listing_id}")
        return False
    await set_full_analysis_status(listing_id, "running")
    try:
        analyze_fn = getattr(analyze_listing, "fn", analyze_listing)
        ok = await analyze_fn(listing, tier="full")
        if not ok:
            await set_full_analysis_status(listing_id, "error")
        return ok
    except Exception:
        await set_full_analysis_status(listing_id, "error")
        raise


# Spaltenliste identisch zu get_listings_without_ki() - analyze_listing()
# erwartet exakt diese Felder (Datenqualitätsprüfung + Cross-Validation).
_ZVG_CANDIDATE_COLUMNS = """
    l.id, l.aktenzeichen, l.typ, l.kategorie, l.verkehrswert, l.beschreibung,
    l.lat, l.lng, l.gutachten_url, l.expose_url,
    l.plz, l.ort, l.bundesland, l.source, l.ist_aktiv, l.termin_date,
    l.wohnflaeche_m2, l.grundstuecksflaeche_m2, l.nutzflaeche_m2,
    l.gesamtflaeche_m2, l.zimmer, l.baujahr,
    to_jsonb(k) AS existing_analysis
"""

_INVESTMENT_ENRICHMENT_NEEDED_CONDITION = """(
        k.investment_score IS NULL
        OR NULLIF(BTRIM(k.investment_score_begruendung), '') IS NULL
        OR COALESCE(
            CASE WHEN jsonb_typeof(k.risiken_investor) = 'array'
                 THEN jsonb_array_length(k.risiken_investor) END,
            0
        ) = 0
        OR jsonb_typeof(k.fix_flip_massnahmen) IS DISTINCT FROM 'array'
    )"""

_DEAL_NEEDED_CONDITION = """(
        COALESCE(l.verkehrswert, 0) > 0
        AND COALESCE(
            CASE WHEN jsonb_typeof(k.fix_flip_massnahmen) = 'array'
                 THEN jsonb_array_length(k.fix_flip_massnahmen) END,
            0
        ) > 0
        AND k.arv_min_eur IS NULL
    )"""

_REANALYSE_NOETIG_CONDITION = f"""(
        k.id IS NULL
        OR (
            k.analysis_tier IS DISTINCT FROM 'basic'
            AND (
                {_INVESTMENT_ENRICHMENT_NEEDED_CONDITION}
                OR {_DEAL_NEEDED_CONDITION}
                OR k.model_used IS NULL
                OR k.model_used NOT LIKE '%{ANALYSIS_SCHEMA_VERSION}%'
            )
        )
    )"""


async def get_zvg_reanalysis_candidates(
    limit: int = 50,
    source_filter: Optional[str] = None,
    full_reanalyze: bool = False,
    only_existing: bool = False,
    offset: int = 0,
) -> list[dict]:
    """Kandidaten für die Investment-Re-Analyse (Teil A/B).

    Gate wie get_listings_without_ki (ist_aktiv, scrape_completed_at,
    mindestens eine Textquelle). Zusätzlich:
      - full_reanalyze=False: nur veraltete/unvollständige Analysen
        (_REANALYSE_NOETIG_CONDITION, inkl. Objekte ganz ohne Analyse).
      - full_reanalyze=True: ALLE bewertbaren aktiven Listings (überschreibt
        via upsert_ki_analyse), Marker-Bedingung wird ignoriert.
      - only_existing=True: nur Listings, die bereits eine KI-Analyse haben
        (für ki_analysis_flow, das die neuen zuerst separat holt).
    """
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    try:
        where = [
            "l.ist_aktiv = TRUE",
            "l.scrape_completed_at IS NOT NULL",
            "((l.beschreibung IS NOT NULL AND length(l.beschreibung) > 50)"
            " OR l.gutachten_url IS NOT NULL OR l.expose_url IS NOT NULL)",
        ]
        if only_existing:
            where.append("k.id IS NOT NULL")
        if not full_reanalyze:
            where.append(_REANALYSE_NOETIG_CONDITION)
        params: list = [limit]
        if source_filter:
            params.append(source_filter)
            where.append(f"l.source = ${len(params)}")
        params.append(offset)
        offset_ph = len(params)
        sql = f"""
            SELECT {_ZVG_CANDIDATE_COLUMNS},
                   CASE
                     WHEN k.id IS NULL THEN 'full'
                     WHEN {_INVESTMENT_ENRICHMENT_NEEDED_CONDITION} THEN 'enrichment'
                     WHEN {_DEAL_NEEDED_CONDITION} THEN 'deal'
                     ELSE 'marker'
                   END AS reanalysis_mode
            FROM zvg_listings l
            LEFT JOIN zvg_ki_analyses k ON k.listing_id = l.id
            WHERE {" AND ".join(where)}
            ORDER BY l.created_at DESC, l.id DESC
            LIMIT $1 OFFSET ${offset_ph}
        """
        rows = await conn.fetch(sql, *params)
        result = []
        for row in rows:
            item = dict(row)
            item["existing_analysis"] = _existing_analysis(item)
            if full_reanalyze:
                item["reanalysis_mode"] = "full"
            result.append(item)
        return result
    finally:
        await conn.close()


async def get_listings_needing_reanalysis(
    limit: int = 50, source_filter: Optional[str] = None
) -> list[dict]:
    """Listings MIT bestehender, aber veralteter/unvollständiger Analyse
    (Teil B Punkt 1). Ergänzt get_listings_without_ki() im ki_analysis_flow:
    zuerst neue Listings ohne Analyse, dann bestehende Lücken - so werden
    veraltete Investment-/Fix&Flip-Felder laufend mitgezogen, ohne
    --full-reanalyze."""
    return await get_zvg_reanalysis_candidates(
        limit=limit, source_filter=source_filter, full_reanalyze=False, only_existing=True
    )


def _log_plausibilitaets_warnung(az: str, verkehrswert, analyse_dict: dict) -> None:
    """
    Zusätzliches Sicherheitsnetz neben der reinen Euro-Parsing-Validierung:
    _parse_euro()/die DB-Range-Prüfung ([1.000, 50.000.000]) erkennt nur grob falsch
    formatierte Werte, nicht aber einen um Faktor ~50-1000 zu niedrigen/hohen Wert
    INNERHALB dieser Range (genau das war die ursprüngliche Vermutung im gemeldeten
    Fall 3-k-11-25-1-hanmark-weissenhorn – der Verkehrswert selbst war dort tatsächlich
    korrekt, aber die von der KI zugeordnete Grundstücksfläche stammte vom falschen
    Teilobjekt, wodurch der €/m²-Wert unplausibel wirkte).

    Loggt lediglich eine WARNING zur manuellen Prüfung; überschreibt nichts automatisch,
    da kein verlässlicherer alternativer Wert vorliegt.
    """
    if not verkehrswert:
        return
    try:
        vw = float(verkehrswert)
    except (TypeError, ValueError):
        return

    for feld, bezeichnung, lo, hi in [
        ("grundstuecksflaeche_m2", "Grundstücksfläche", 2, 20_000),
        ("wohnflaeche_m2", "Wohnfläche", 200, 20_000),
    ]:
        flaeche = analyse_dict.get(feld)
        if not flaeche or flaeche <= 0:
            continue
        eur_pro_m2 = vw / flaeche
        if eur_pro_m2 < lo or eur_pro_m2 > hi:
            logger.warning(
                f"hanmark KI-Plausibilität [{az}]: Verkehrswert {vw:,.0f} € / "
                f"{bezeichnung} {flaeche:,.0f} m² = {eur_pro_m2:,.0f} €/m² "
                f"(außerhalb Plausibilitätsbereich [{lo}, {hi}] €/m²) – bitte manuell prüfen, "
                f"ob Fläche/Beschreibung ggf. vom falschen Teilobjekt stammt."
            )


def run_extract_analysis(
    client: instructor.Instructor,
    model: str,
    listing: dict,
    analyse_text: str,
    response_model,
    max_tokens: int = 4096,
):
    return _create_with_token_usage(
        client,
        model=model,
        max_tokens=max_tokens,
        response_model=response_model,
        messages=[
            {
                "role": "user",
                "content": (
                    "Analysiere diesen Zwangsversteigerungs-Gutachtentext strukturiert. "
                    "Extrahiere alle verfügbaren Informationen exakt wie beschrieben. "
                    "Halluziniere KEINE Werte. Fehlende Informationen → null.\n\n"
                    f"{build_teilobjekt_hinweis(listing)}\n\n"
                    f"{analyse_text}"
                ),
            }
        ],
    )


@task(retries=2, retry_delay_seconds=30)
async def analyze_listing(listing: dict, tier: Optional[str] = None) -> bool:
    """Basis: Haiku-Fakten. Voll: Haiku-Fakten plus Sonnet-Investment."""
    client, _invest_default = get_langdock_client()
    extract_model = langdock_extract_model()
    invest_model = langdock_invest_model()
    listing_id = str(listing["id"])
    status = await get_ki_analysis_status(listing_id)
    existing_tier = (status or {}).get("analysis_tier")
    if tier is None:
        tier = existing_tier or "basic"
    if tier == "basic" and should_skip_basic_for_status(status):
        logger.info(
            f"Basisanalyse übersprungen [{listing.get('aktenzeichen')}]: "
            f"tier={existing_tier} status={(status or {}).get('full_status')}"
        )
        return True

    try:
        # Textquellen laden (Beschreibung kommt direkt aus dem listing-dict).
        gutachten_url = listing.get("gutachten_url", "")
        gutachten_text = ""
        if gutachten_url:
            logger.info(f"Lade Gutachten-PDF für {listing['aktenzeichen']}: {gutachten_url}")
            gutachten_text = await download_pdf_text(gutachten_url)
            if gutachten_text:
                logger.info(
                    f"Gutachten-Text extrahiert: {len(gutachten_text)} Zeichen "
                    f"für {listing['aktenzeichen']}"
                )

        expose_url = listing.get("expose_url", "")
        expose_text = ""
        if expose_url:
            logger.info(f"Lade Expose-PDF für {listing['aktenzeichen']}: {expose_url}")
            expose_text = await download_pdf_text(expose_url)
            if expose_text:
                logger.info(
                    f"Expose-Text extrahiert: {len(expose_text)} Zeichen "
                    f"für {listing['aktenzeichen']}"
                )
        expose_included = bool(expose_text)

        # Geringstes Gebot und bestehenbleibende Rechte stehen in der
        # Terminsbestimmung und wurden bisher nirgends gelesen; die Oberflaeche
        # hat sie deshalb geschaetzt. Regelbasiert, weil der Text ein Formular
        # ist - was nicht eindeutig dasteht, bleibt leer.
        terms = parse_terminsbestimmung(expose_text or listing.get("beschreibung"))
        if terms.brauchbar:
            gespeichert = await update_auction_terms(
                listing_id=listing_id,
                geringstes_gebot_eur=terms.geringstes_gebot_eur,
                bestehende_rechte_eur=terms.bestehende_rechte_eur,
                bestehende_rechte_text=terms.bestehende_rechte_text,
            )
            if gespeichert:
                logger.info(
                    f"Terminsbestimmung [{listing['aktenzeichen']}]: "
                    f"geringstes Gebot={terms.geringstes_gebot_eur}, "
                    f"bestehenbleibende Rechte={terms.bestehende_rechte_eur}"
                )

        # Kontext-Aufbereitung (Baustein 2.2, siehe ki_context.py): Dedup
        # zwischen Gutachten/Exposé + Boilerplate-Entfernung statt der
        # bisherigen pauschalen Kopf/Fuß-Zeichen-Truncation.
        analyse_text = build_analysis_context(listing, gutachten_text, expose_text, tier=tier)
        if not analyse_text:
            logger.info(f"Kein analysierbarer Text für {listing['aktenzeichen']}, überspringe")
            return False

        response_model = KIBasicAnalyseResult if tier == "basic" else KIFactExtractResult
        max_tokens = 4096 if tier == "basic" else 8192
        result, input_tokens, output_tokens = await asyncio.to_thread(
            run_extract_analysis,
            client,
            extract_model,
            listing,
            analyse_text,
            response_model,
            max_tokens,
        )
        analyse_dict = result.model_dump()

        if tier == "full":
            listing_for_enrich = {**listing, "existing_analysis": analyse_dict}
            enrich, e_in, e_out = await asyncio.to_thread(
                run_investment_enrichment,
                client,
                invest_model,
                listing_for_enrich,
            )
            if not has_documented_renovation_need(listing_for_enrich, analyse_dict):
                enrich = enrich.model_copy(
                    update={"fix_flip_massnahmen": [], "fix_flip_werteinschaetzung": None}
                )
            analyse_dict.update(enrich.model_dump())
            input_tokens += e_in
            output_tokens += e_out

        orte = []
        coords = parse_usable_geo_point(listing.get("lat"), listing.get("lng"))
        if coords:
            orte = await get_nearby_pois(coords[0], coords[1])

        analyse_dict["orte_in_der_naehe"] = [o.model_dump() for o in orte]

        if tier == "full":
            massnahmen = [
                FixFlipMassnahme(**item) if isinstance(item, dict) else item
                for item in (analyse_dict.get("fix_flip_massnahmen") or [])
            ]
            fix_flip_min, fix_flip_max = _sum_fix_flip_kosten(massnahmen)
            analyse_dict["fix_flip_gesamtkosten_min_eur"] = fix_flip_min
            analyse_dict["fix_flip_gesamtkosten_max_eur"] = fix_flip_max
            if massnahmen and listing.get("verkehrswert"):
                try:
                    deal_fields, deal_input_tokens, deal_output_tokens = await asyncio.to_thread(
                        estimate_and_calc_fix_flip_deal_with_usage,
                        client,
                        extract_model,
                        listing,
                        massnahmen,
                        fix_flip_min,
                        fix_flip_max,
                    )
                    analyse_dict.update(deal_fields)
                    input_tokens += deal_input_tokens
                    output_tokens += deal_output_tokens
                except Exception as exc:
                    logger.warning(
                        f"Fix&Flip-Deal-Kalkulation fehlgeschlagen ({listing['aktenzeichen']}): {exc}"
                    )

        tokens_used = input_tokens + output_tokens
        _log_plausibilitaets_warnung(
            listing["aktenzeichen"], listing.get("verkehrswert"), analyse_dict
        )

        cross_flags = cross_validate_ki_result(listing, analyse_dict)
        for f in cross_flags:
            logger.warning(f"Cross-Validation [{listing['aktenzeichen']}]: {f.message}")

        effective_model = extract_model if tier == "basic" else f"{extract_model}+{invest_model}"
        if expose_included:
            effective_model = f"{effective_model}+expose"
        await upsert_ki_analyse(
            listing_id=listing_id,
            analyse=analyse_dict,
            model_used=effective_model,
            tokens_used=tokens_used,
            analysis_tier=tier,
            full_status="idle",
        )

        await update_listing_grunddaten(
            listing_id=listing_id,
            wohnflaeche_m2=analyse_dict.get("wohnflaeche_m2"),
            grundstuecksflaeche_m2=analyse_dict.get("grundstuecksflaeche_m2"),
            baujahr=analyse_dict.get("baujahr"),
            zimmer=analyse_dict.get("zimmer"),
            beschreibung=analyse_dict.get("beschreibung"),
        )

        # Vollständige Plausibilitätsprüfung (alle Felder, siehe
        # data_quality.py) auf dem finalen Stand nach KI-Anreicherung -
        # frisch aus der DB geladen, da update_listing_grunddaten() ggf.
        # zuvor NULL-Felder befüllt hat.
        try:
            final_listing = await get_listing_for_quality_check(listing_id)
            if final_listing:
                ki_row = final_listing.get("ki_analyse") or {}
                flags = evaluate_listing(final_listing, ki=ki_row)
                flags += cross_flags
                await update_data_quality_flags(
                    listing_id, flags_to_json(flags), needs_review(flags)
                )
                if flags:
                    logger.info(
                        f"Datenqualität [{listing['aktenzeichen']}]: {len(flags)} Flag(s), "
                        f"needs_review={needs_review(flags)}"
                    )
        except Exception as exc:
            logger.warning(
                f"Datenqualitätsprüfung fehlgeschlagen für {listing['aktenzeichen']}: {exc}"
            )

        logger.info(
            f"KI-Analyse abgeschlossen: {listing['aktenzeichen']} "
            f"(input_tokens={input_tokens}, output_tokens={output_tokens})"
        )
        return True

    except Exception as e:
        logger.error(f"KI-Analyse fehlgeschlagen {listing['aktenzeichen']}: {e}")
        return False


@task(retries=2, retry_delay_seconds=30)
async def enrich_listing_investment(listing: dict) -> bool:
    client, model = get_langdock_client()
    existing = _existing_analysis(listing)

    try:
        result, input_tokens, output_tokens = await asyncio.to_thread(
            run_investment_enrichment,
            client,
            model,
            listing,
        )
        if not result.investment_score_begruendung.strip() or not result.risiken_investor:
            logger.warning(f"Investment-Enrichment unvollständig: {listing['aktenzeichen']}")
            return False
        if not has_documented_renovation_need(listing):
            result = result.model_copy(
                update={"fix_flip_massnahmen": [], "fix_flip_werteinschaetzung": None}
            )

        analyse_dict = result.model_dump()
        fix_flip_min, fix_flip_max = _sum_fix_flip_kosten(result.fix_flip_massnahmen)
        analyse_dict["fix_flip_gesamtkosten_min_eur"] = fix_flip_min
        analyse_dict["fix_flip_gesamtkosten_max_eur"] = fix_flip_max

        if result.fix_flip_massnahmen and (listing.get("verkehrswert") or 0) > 0:
            deal_fields, deal_input_tokens, deal_output_tokens = await asyncio.to_thread(
                estimate_and_calc_fix_flip_deal_with_usage,
                client,
                model,
                listing,
                result.fix_flip_massnahmen,
                fix_flip_min,
                fix_flip_max,
            )
            analyse_dict.update(deal_fields)
            input_tokens += deal_input_tokens
            output_tokens += deal_output_tokens

        await update_investment_enrichment(
            str(listing["id"]),
            analyse_dict,
            existing.get("model_used") or model,
            input_tokens + output_tokens,
        )
        logger.info(
            f"Investment-Enrichment abgeschlossen: {listing['aktenzeichen']} "
            f"(input_tokens={input_tokens}, output_tokens={output_tokens})"
        )
        return True
    except Exception as exc:
        logger.error(f"Investment-Enrichment fehlgeschlagen {listing['aktenzeichen']}: {exc}")
        return False


async def mark_listing_analysis_current(listing: dict) -> bool:
    existing = _existing_analysis(listing)
    marked = await mark_ki_analysis_schema_current(
        str(listing["id"]),
        existing.get("model_used"),
        INVESTMENT_PROMPT_LIVE_AFTER,
    )
    if not marked:
        logger.warning(
            f"Schema-Marker-Sicherheitsprüfung fehlgeschlagen: {listing['aktenzeichen']}"
        )
    return marked


async def get_nearby_pois(lat: float, lng: float) -> list[OrtInDerNaehe]:
    """Holt POIs via OpenStreetMap Overpass API (kostenlos, kein API-Key)."""
    query = f"""
    [out:json][timeout:25];
    (
      node["amenity"~"supermarket|school|bus_stop|subway_entrance|hospital|pharmacy"]
           (around:1000,{lat},{lng});
      node["shop"="supermarket"](around:1000,{lat},{lng});
    );
    out body;
    """

    try:
        async with httpx.AsyncClient(
            timeout=30,
            headers={"User-Agent": "Gavel/1.0 (research tool)"},
        ) as client:
            resp = await client.post(
                "https://overpass-api.de/api/interpreter",
                data={"data": query},
            )
            resp.raise_for_status()
            data = resp.json()

        KATEGORIE_MAP = {
            "supermarket": "Supermarkt",
            "school": "Schule",
            "bus_stop": "ÖPNV",
            "subway_entrance": "ÖPNV",
            "hospital": "Krankenhaus",
            "pharmacy": "Apotheke",
        }

        pois = []
        for el in data.get("elements", [])[:10]:
            name = el.get("tags", {}).get("name", "Unbekannt")
            amenity = el.get("tags", {}).get("amenity", "")
            kategorie = KATEGORIE_MAP.get(amenity, amenity)

            poi = OrtInDerNaehe(
                name=name,
                adresse=el.get("tags", {}).get("addr:street", ""),
                kategorie=kategorie,
            )
            pois.append(poi)

        return pois

    except Exception as e:
        logger.warning(f"Overpass API Fehler: {e}")
        return []


async def get_listings_needing_expose_reanalysis(limit: int = 50) -> list[dict]:
    """Holt Listings mit expose_url, deren KI-Analyse noch kein Expose enthielt."""
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    try:
        rows = await conn.fetch(
            """
            SELECT l.id, l.aktenzeichen, l.typ, l.kategorie, l.verkehrswert, l.beschreibung,
                   l.lat, l.lng, l.gutachten_url, l.expose_url,
                   l.plz, l.ort, l.bundesland, l.source, l.ist_aktiv, l.termin_date,
                   l.wohnflaeche_m2, l.grundstuecksflaeche_m2, l.nutzflaeche_m2,
                   l.gesamtflaeche_m2, l.zimmer, l.baujahr
            FROM zvg_listings l
            JOIN zvg_ki_analyses k ON k.listing_id = l.id
            WHERE l.expose_url IS NOT NULL
              AND l.ist_aktiv = TRUE
              AND l.scrape_completed_at IS NOT NULL
              AND (k.model_used IS NULL OR k.model_used NOT LIKE '%+expose%')
            ORDER BY l.updated_at DESC
            LIMIT $1
            """,
            limit,
        )
        return [dict(r) for r in rows]
    finally:
        await conn.close()


@flow(
    name="reanalyze-with-expose",
    description="Re-analysiert Listings mit expose_url, die noch kein Exposé enthalten",
    log_prints=True,
)
async def reanalyze_with_expose(limit: int = 50):
    """
    Re-analysiert Listings die bereits eine KI-Analyse haben,
    aber deren Analyse ohne Exposé-Text erstellt wurde (model_used enthält kein '+expose').
    """
    logger = get_run_logger()

    listings = await get_listings_needing_expose_reanalysis(limit)
    logger.info(f"Re-Analyse mit Exposé: {len(listings)} Listings gefunden")

    if not listings:
        logger.info("Keine Listings benötigen Re-Analyse mit Exposé")
        return

    success = 0
    for listing in listings:
        ok = await analyze_listing(listing)
        if ok:
            success += 1
        await asyncio.sleep(2)

    logger.info(f"Re-Analyse: {success}/{len(listings)} erfolgreich")


@task(retries=2, retry_delay_seconds=30)
async def _reanalyze_single_fix_flip_deal(listing: dict) -> bool:
    """Holt für EIN Listing nur den zweiten ARV-LLM-Call + Python-Kalkulation
    nach (siehe reanalyze_fix_flip_deal) - kein vollständiger Gutachten-
    Re-Scan, da fix_flip_massnahmen bereits aus einer früheren Analyse
    vorliegen."""
    existing = _existing_analysis(listing)
    massnahmen_raw = listing.get("fix_flip_massnahmen") or existing.get("fix_flip_massnahmen") or []
    if isinstance(massnahmen_raw, str):
        massnahmen_raw = json.loads(massnahmen_raw)
    massnahmen = [FixFlipMassnahme(**m) for m in massnahmen_raw]
    if not massnahmen:
        return False

    try:
        client, model = get_langdock_client()
        fix_flip_min = listing.get("fix_flip_gesamtkosten_min_eur") or existing.get(
            "fix_flip_gesamtkosten_min_eur"
        )
        fix_flip_max = listing.get("fix_flip_gesamtkosten_max_eur") or existing.get(
            "fix_flip_gesamtkosten_max_eur"
        )
        felder, input_tokens, output_tokens = await asyncio.to_thread(
            estimate_and_calc_fix_flip_deal_with_usage,
            client,
            model,
            listing,
            massnahmen,
            fix_flip_min,
            fix_flip_max,
        )
        if not felder:
            logger.warning(
                f"Fix&Flip-Re-Analyse ohne Ergebnis ({listing['aktenzeichen']}): kein Verkehrswert?"
            )
            return False
        await update_fix_flip_deal(
            str(listing["id"]),
            felder,
            model_used=(
                existing.get("model_used") or model
                if listing.get("reanalysis_mode") == "deal"
                else None
            ),
            tokens_used=input_tokens + output_tokens,
        )
        logger.info(
            f"Fix&Flip-Re-Analyse abgeschlossen: {listing['aktenzeichen']} "
            f"(input_tokens={input_tokens}, output_tokens={output_tokens})"
        )
        return True
    except Exception as e:
        logger.error(f"Fix&Flip-Re-Analyse fehlgeschlagen ({listing['aktenzeichen']}): {e}")
        return False


async def analyze_reanalysis_candidate(listing: dict) -> bool:
    mode = listing.get("reanalysis_mode", "full")
    if mode == "enrichment":
        return await enrich_listing_investment(listing)
    if mode == "deal":
        return await _reanalyze_single_fix_flip_deal(listing)
    if mode == "marker":
        return await mark_listing_analysis_current(listing)
    return await analyze_listing(listing)


@flow(
    name="reanalyze-fix-flip-deal",
    description="Holt die Fix&Flip-Deal-Kalkulation (ARV/Gewinn/ROI) für bereits analysierte Listings nach",
    log_prints=True,
)
async def reanalyze_fix_flip_deal(limit: int = 50):
    """
    Re-analysiert Listings, die bereits Fix&Flip-Maßnahmen (aus der
    regulären KI-Analyse) haben, aber noch keine Deal-Kalkulation (Ziel 6) -
    z.B. weil sie vor Einführung dieses Features analysiert wurden. Holt NUR
    den zweiten, kleinen ARV-LLM-Call + die Python-Kalkulation nach
    (Effizienz - kein vollständiger Gutachten-Re-Scan nötig).
    """
    logger = get_run_logger()

    listings = await get_listings_for_fix_flip_deal_reanalysis(limit)
    logger.info(f"Fix&Flip-Deal-Re-Analyse: {len(listings)} Listings gefunden")

    if not listings:
        logger.info("Keine Listings benötigen eine Fix&Flip-Deal-Re-Analyse")
        return

    success = 0
    for listing in listings:
        ok = await _reanalyze_single_fix_flip_deal(listing)
        if ok:
            success += 1
        await asyncio.sleep(2)

    logger.info(f"Fix&Flip-Deal-Re-Analyse: {success}/{len(listings)} erfolgreich")


@flow(
    name="ki-analysis",
    description="Stündliche KI-Analyse neuer ZVG-Listings via Langdock (Claude Sonnet 4.6)",
    log_prints=True,
)
async def ki_analysis_flow(
    limit: int = 50,
    source_filter: Optional[str] = None,
    concurrency: int = 3,
    occupy_worker: bool = False,
    exclude_ids: Optional[list[str]] = None,
):
    """Analysiert neue Listings ohne KI-Analyse.

    Args:
        limit: Maximale Anzahl zu analysierender Listings pro Lauf.
        source_filter: Optional – nur Listings dieser Quelle analysieren (z.B. 'hanmark.de').
        concurrency: Maximal drei parallele Listing-Analysen.
        occupy_worker: True im Worker-Backup, damit KI nicht parallel zum
            Daily-Scrape denselben Cgroup-RAM frisst. Daily selbst übergibt False,
            weil es den Heavy-Lock schon hält. Extra-Läufe auf dem Scraper: False.
    """
    if occupy_worker:
        async with hold_heavy_run_lock():
            return await _run_ki_analysis(limit, source_filter, concurrency, exclude_ids)
    return await _run_ki_analysis(limit, source_filter, concurrency, exclude_ids)


async def _run_ki_analysis(
    limit: int,
    source_filter: Optional[str],
    concurrency: int,
    exclude_ids: Optional[list[str]] = None,
):
    logger = get_run_logger()
    if concurrency < 1 or concurrency > 3:
        raise ValueError("concurrency muss zwischen 1 und 3 liegen")

    async with try_analysis_run_lock() as lock_acquired:
        if not lock_acquired:
            logger.warning(
                "KI-Analyse übersprungen: Investment-Backfill oder anderer KI-Lauf ist aktiv"
            )
            return {"skipped": True, "reason": "analysis-run-active", "attempted": 0}

        filter_info = f" (source={source_filter})" if source_filter else ""

        listings = await get_listings_without_ki(
            limit, source_filter=source_filter, exclude_ids=exclude_ids
        )
        logger.info(f"KI-Basisanalyse{filter_info}: {len(listings)} neue Listings ohne Analyse")

        if not listings:
            logger.info("Keine neuen Listings für KI-Analyse")
            return {"attempted": 0, "items_new": 0, "items_updated": 0, "failed": 0}

        semaphore = asyncio.Semaphore(concurrency)

        async def run_one(listing: dict) -> bool:
            async with semaphore:
                ok = await analyze_listing(listing, tier="basic")
                await asyncio.sleep(2)
                return ok

        results = await asyncio.gather(*(run_one(listing) for listing in listings))
        success = sum(results)
        items_new = success
        items_updated = 0

        failed_ids = [str(listing["id"]) for listing, ok in zip(listings, results) if not ok]
        logger.info(f"KI-Analyse: {success}/{len(listings)} erfolgreich")
        return {
            "attempted": len(listings),
            "items_new": items_new,
            "items_updated": items_updated,
            "failed": len(listings) - success,
            "analyzed": success,
            "failed_ids": failed_ids,
        }


if __name__ == "__main__":
    asyncio.run(
        ki_analysis_flow.serve(
            name="ki-analysis-deployment",
            cron="0 * * * *",
        )
    )
