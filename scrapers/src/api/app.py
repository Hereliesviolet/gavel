"""
FastAPI-Backend für die Custom-URL-Analyse - läuft als dritter paralleler
Prozess im bestehenden Scraper-Container (siehe infra/docker/
docker-compose.prod.yml command-Feld des scraper-Service).

Endpunkt: POST /internal/analyze-url(-async) {url?, job_id?, html?,
pdf_base64?, cookie_header?} — Nutzeranalysen nur über job_id (user_id
kommt aus der queued Job-Zeile). Systemläufe ohne Job/User.
Nur intern auf gavel_net erreichbar (kein Host-Port, kein Caddy-Routing),
zusätzlich per Bearer-Token (SCRAPER_API_SECRET) geschützt - analog zum
bestehenden CRON_SECRET-Muster (siehe apps/web/app/api/cron/*). Aufgerufen
von apps/web/app/api/analyse/route.ts (die zuvor die Nutzer-Session prüft).

Drei Content-Quellen (siehe docs/CUSTOM_URL_ANALYSIS.md):
  - Live-Fetch: jede öffentliche https-URL (SSRF-geprüft, siehe url_safety.py),
    optional mit vom Nutzer explizit eingefügtem Opt-in-Session-Cookie für
    login-geschützte Angebote (isolierter Fetch, nicht persistiert).
  - HTML-Einfügung: Nutzer kopiert den Seitenquelltext selbst (privater
    Zugriff, kein automatischer Fetch nötig).
  - PDF-Upload: Text wird via pdfplumber extrahiert.

Ablauf (identisch für alle drei Quellen ab hier):
  1. Generisches Pydantic-Schema via Instructor/Langdock (Claude, dieselbe
     Anbindung wie die bestehende KI-Analyse in ki_analysis.py) aus dem
     Seiteninhalt extrahieren - inkl. Klassifikation, ob es sich überhaupt
     um ein Immobilienangebot handelt.
  2. real_estate_listings upserten (Conflict-Key external_id+source).
  3. Marktfokussierte KI-Analyse (Preis-Fairness, Stärken/Schwächen, Lage,
     optionale Rendite-Schätzung, Investoren-Einschätzung) gegen
     real_estate_ki_analyses schreiben.
  4. Erkannte Bilder (Obergrenze 12) parallel nach MinIO hochladen und in
     real_estate_images speichern (Refresh ersetzt alte Bilder), cover_image_url
     auf die hochgeladene public_url des ersten Bilds setzen. Best-effort.
  5. custom_url_requests IMMER protokollieren (Erfolg wie Fehler).

Best-effort-Verhalten: Bei Anti-Bot-Block/Timeout/Layoutfehler/Nicht-Angebots-
Seiten wird eine klare, strukturierte Fehlermeldung zurückgegeben (kein
Absturz, kein stiller Fake-Erfolg, keine erfundenen Werte).
"""

import asyncio
import contextvars
import json
import os
import re
import time
import uuid
from contextlib import asynccontextmanager, suppress
from typing import Optional
from urllib.parse import urlparse

from anthropic import RateLimitError as AnthropicRateLimitError
from bs4 import BeautifulSoup
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, PlainTextResponse
from loguru import logger
from pydantic import BaseModel

from src.flows.ki_analysis import (
    extract_pdf_text,
    get_langdock_client,
    get_nearby_pois,
    has_documented_renovation_need,
    run_requested_full_analysis,
)
from src.models.real_estate import (
    CustomListingExtraction,
    CustomMarketAnalyse,
    FixFlipDealSchaetzung,
    FixFlipMassnahme,
)
from src.storage.minio import upload_image
from src.storage.real_estate import (
    persist_custom_url_listing_and_ki,
    log_custom_url_request,
    count_real_estate_images,
    replace_real_estate_images,
    reap_stale_analyse_jobs,
    claim_queued_analyse_job,
    update_analyse_job,
    peek_existing_real_estate_state,
    refresh_target_gone,
    job_expected_listing_id,
    RealEstateListingGoneError,
    _blank_to_none,
)
from src.utils.burst_limit import (
    BurstLimiter,
    allow_shared_burst,
    release_shared_slot,
    try_claim_shared_slot,
)
from src.utils.secret_compare import bearer_matches
from src.utils.sentry import capture_exception
from src.utils.url_safety import (
    UrlSafetyError,
    assert_analyse_listing_url,
    log_safe_url,
    public_url_safety_message,
    strip_sensitive_query,
    assert_no_unsafe_redirect,
    assert_public_http_url,
    url_safety_error_code,
)

MAX_CONCURRENT_SYSTEM_ANALYSES = 2
MAX_CONCURRENT_SYNC_ANALYSES = 2
_LOG_CUSTOM_URL_REQUEST = contextvars.ContextVar("log_custom_url_request", default=True)
ANALYSE_BURST_MAX = 5
ANALYSE_BURST_WINDOW_SEC = 60
_analyse_burst = BurstLimiter(ANALYSE_BURST_MAX, ANALYSE_BURST_WINDOW_SEC)
_system_analyse_lock = asyncio.Lock()
_system_analyse_inflight = 0
_sync_analyse_lock = asyncio.Lock()
_sync_analyse_inflight = 0
from src.utils.content_price import abgleich_angebot_extraktion, preis_aus_text
from src.utils.content_slicer import slice_listing_content
from src.utils.geocoding import coherent_location, geocode_with_fallback, location_identity
from src.utils.manual_content import (
    MAX_MANUAL_HTML_CHARS,
    ManualContentError,
    build_manual_reference_url,
    decode_pdf_base64,
    parse_cookie_header,
)
from src.utils.scrape_images import extract_listing_images
from src.utils.scrape_ladder import (
    MIN_MARKDOWN_CHARS,
    ResilientScrapeResult,
    ScrapeMetadata,
    fetch_page_resilient,
)
from src.utils.page_fetch import html_to_markdown


SCRAPER_API_SECRET = os.environ.get("SCRAPER_API_SECRET")
MAX_MARKDOWN_CHARS_FOR_EXTRACTION = 40000
MAX_IMAGES_PER_LISTING = 12
MAX_MARKET_ANALYSIS_TOKENS = 12288
MIN_MANUAL_PDF_TEXT_CHARS = 200

# Begrenzung auf den Seitenanfang: Preis-Badges stehen bei den beobachteten
# Portalen (kleinanzeigen.de u.a.) direkt unter Titel/Bildergalerie, also
# weit vor "Ähnliche Anzeigen"/Empfehlungen weiter unten auf der Seite.
_PREIS_FALLBACK_TEXT_CHARS = 5000


def _normalize_source_url(url: str) -> str:
    """Scheme/Host bereinigen; Tracking-Query und Portal-Identitäts-Query
    entfernen (sonst Duplikat-Listings und häufigere ImmoScout-401)."""
    from src.storage.listing_scope import listing_url_identity
    from src.utils.url_safety import normalize_listing_url

    return listing_url_identity(strip_sensitive_query(normalize_listing_url(url)))


@asynccontextmanager
async def _lifespan(app: FastAPI):
    try:
        n = await reap_stale_analyse_jobs()
        if n:
            logger.warning(f"Startup: {n} hängende Analyse-Jobs als error markiert")
    except Exception as e:
        logger.warning(f"Startup-Job-Reaper fehlgeschlagen: {e}")
    reaper = asyncio.create_task(_analyse_reaper_loop(), name="analyse-job-reaper")
    try:
        yield
    finally:
        reaper.cancel()
        with suppress(asyncio.CancelledError):
            await reaper


_REAPER_INTERVAL_SEC = 10 * 60


async def _analyse_reaper_loop() -> None:
    while True:
        await asyncio.sleep(_REAPER_INTERVAL_SEC)
        try:
            n = await reap_stale_analyse_jobs()
            if n:
                logger.warning(f"Reaper: {n} hängende Analyse-Jobs als error markiert")
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.warning(f"Periodischer Job-Reaper fehlgeschlagen: {e}")


app = FastAPI(
    title="Gavel Scraper-Internal-API",
    lifespan=_lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


@app.exception_handler(RequestValidationError)
async def _validation_error(_request: Request, _exc: RequestValidationError) -> JSONResponse:
    return JSONResponse({"detail": "Ungültige Anfrage"}, status_code=422)


@app.exception_handler(Exception)
async def _unhandled_exception(request: Request, exc: Exception) -> JSONResponse:
    if isinstance(exc, HTTPException):
        raise exc
    logger.exception(f"Unbehandelter API-Fehler ({request.url.path}): {exc}")
    capture_exception(exc, path=request.url.path)
    return JSONResponse({"detail": "Interner Fehler"}, status_code=500)


class AnalyzeUrlRequest(BaseModel):
    url: Optional[str] = None
    user_id: Optional[str] = None
    job_id: Optional[str] = None
    # Phase 3 (private/login-geschützte Angebote) - genau EIN Content-Modus
    # zusätzlich zum Live-Fetch. `url` bleibt dabei optional als Referenz/Link
    # zur Originalanzeige (kein Fetch dorthin).
    html: Optional[str] = None
    pdf_base64: Optional[str] = None
    cookie_header: Optional[str] = None


class AnalyzeUrlResponse(BaseModel):
    ok: bool
    listing_id: Optional[str] = None
    error: Optional[str] = None
    error_code: Optional[str] = None


class AnalyzeUrlAsyncResponse(BaseModel):
    ok: bool
    job_id: Optional[str] = None
    error: Optional[str] = None
    error_code: Optional[str] = None


async def _set_job_progress(
    job_id: Optional[str],
    *,
    status: Optional[str] = None,
    step: Optional[str] = None,
    progress_pct: Optional[int] = None,
    step_detail: Optional[str] = None,
    error_message: Optional[str] = None,
    listing_id: Optional[str] = None,
    heartbeat: bool = False,
    phase: Optional[str] = None,
    kind: Optional[str] = None,
    preview: Optional[dict] = None,
) -> None:
    if not job_id:
        return
    if step_detail is not None:
        step_detail = public_job_error_message(step_detail)
    if error_message is not None:
        error_message = public_job_error_message(error_message)
    await update_analyse_job(
        job_id,
        status=status,
        step=step,
        progress_pct=progress_pct,
        step_detail=step_detail,
        error_message=error_message,
        listing_id=listing_id,
        heartbeat=heartbeat,
        phase=phase,
        kind=kind,
        preview=preview,
    )


_INTERNAL_JOB_ERROR = re.compile(
    r"Traceback|File \"|Exception:|httpx\.|ssl\.|socket\.|"
    r"ConnectError|TimeoutError|OperationalError|ECONNREFUSED|Errno |"
    r"net::ERR_|ERR_CONNECTION|"
    r"SCRAPER_API_SECRET|serverseitig nicht konfiguriert|^Unauthorized$|"
    r"\b(?:postgres|redis|minio|localhost)(?::\d+)?\b|"
    r"\b\d{1,3}(?:\.\d{1,3}){3}\b|"
    r"\.(?:internal|local|svc|cluster\.local)\b",
    re.IGNORECASE,
)


def public_job_error_message(message: Optional[str]) -> str:
    trimmed = (message or "").strip()
    if not trimmed or _INTERNAL_JOB_ERROR.search(trimmed):
        return "Bei der Analyse ist ein unerwarteter Fehler aufgetreten."
    return trimmed


def _map_fetch_progress(msg: str) -> str:
    """Interne Ladder-Meldungen → ruhige UI-Statuszeilen."""
    m = msg.strip()
    low = m.lower()
    if "abruf fehlgeschlagen" in low:
        return "Abruf fehlgeschlagen"
    if "robots" in low:
        return "Abruf laut robots.txt nicht erlaubt"
    if "bot-wall" in low or "bot wall" in low:
        return "Seite schützt sich gegen automatischen Abruf"
    if "rate-limit" in low or "cooldown" in low:
        return "Kurz warten · neuer Versuch…"
    if "dns" in low:
        return "Seite nicht erreichbar"
    if "inhalt unzureichend" in low:
        return "Zu wenig Inhalt auf der Seite"
    if m.startswith("Fetch ·"):
        return "Exposé wird geladen…"
    return "Seite wird geladen…"


@asynccontextmanager
async def _job_heartbeat(job_id: Optional[str], label: str, phase: str):
    """Schreibt jede Sekunde eine lebende step_log-Zeile während langer awaits."""
    if not job_id:
        yield
        return

    stop = asyncio.Event()
    started = time.monotonic()

    async def _beat() -> None:
        while not stop.is_set():
            try:
                await asyncio.wait_for(stop.wait(), timeout=1.0)
                return
            except asyncio.TimeoutError:
                elapsed = int(time.monotonic() - started)
                await _set_job_progress(
                    job_id,
                    step_detail=f"{label} · {elapsed}s",
                    heartbeat=True,
                    phase=phase,
                )

    task = asyncio.create_task(_beat())
    try:
        yield
    finally:
        stop.set()
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


def _fairness_label(raw: Optional[str]) -> str:
    mapping = {
        "günstig": "eher günstig",
        "marktüblich": "marktüblich",
        "teuer": "eher teuer",
        "unbekannt": "noch unklar",
    }
    if not raw:
        return "noch unklar"
    return mapping.get(raw, raw)


def _investment_label(raw: Optional[str]) -> Optional[str]:
    mapping = {
        "attraktiv": "attraktiv",
        "neutral": "neutral",
        "abraten": "abraten",
    }
    if not raw:
        return None
    return mapping.get(raw)


async def _fail_job_or_log(
    job_id: Optional[str],
    user_id: Optional[str],
    url: str,
    error_message: str,
    user_facing: str,
    *,
    step: str = "failed",
    error_code: Optional[str] = None,
) -> AnalyzeUrlResponse:
    safe = public_job_error_message(user_facing)
    if job_id:
        await _set_job_progress(
            job_id,
            status="error",
            step=step,
            step_detail=safe[:120],
            error_message=safe,
        )
    elif _LOG_CUSTOM_URL_REQUEST.get():
        await log_custom_url_request(user_id, url, "error", safe)
    return AnalyzeUrlResponse(ok=False, error=safe, error_code=error_code)


async def _fail_if_refresh_target_gone(
    job_id: Optional[str],
    user_id: Optional[str],
    url: str,
    existing_id: Optional[str],
    expected_id: Optional[str],
    *,
    step: str,
) -> Optional[AnalyzeUrlResponse]:
    if not refresh_target_gone(existing_id, expected_id):
        return None
    return await _fail_job_or_log(
        job_id,
        user_id,
        url,
        "Refresh abgebrochen: Listing gelöscht",
        ("Das gespeicherte Angebot ist nicht mehr vorhanden. Es wurde nichts neu angelegt."),
        step=step,
        error_code="LISTING_GONE",
    )


def _check_auth(authorization: Optional[str]) -> None:
    if not SCRAPER_API_SECRET:
        raise HTTPException(500, "Interner Fehler")
    if not bearer_matches(authorization, SCRAPER_API_SECRET):
        raise HTTPException(401, "Unauthorized")


def _reject_analyse_burst(user_id: Optional[str]) -> None:
    if not allow_shared_burst(
        user_id or "system",
        ANALYSE_BURST_MAX,
        ANALYSE_BURST_WINDOW_SEC,
        fail_closed=True,
        memory=_analyse_burst,
    ):
        raise HTTPException(429, "Zu viele Analyse-Anfragen. Bitte kurz warten.")


def _reject_client_user_id(user_id: Optional[str]) -> None:
    if user_id is None:
        return
    if str(user_id).strip():
        raise HTTPException(422, "user_id darf nicht vom Client gesetzt werden")


def _normalize_optional_job_id(job_id: Optional[str]) -> Optional[str]:
    if job_id is None:
        return None
    raw = str(job_id).strip()
    if not raw:
        return None
    try:
        return str(uuid.UUID(raw))
    except ValueError:
        raise HTTPException(422, "job_id ist ungültig") from None


def reject_unbound_user_analyse(job_id: Optional[str], user_id: Optional[str]) -> None:
    if job_id or not user_id:
        return
    raise HTTPException(
        422,
        "Nutzeranalysen müssen über einen bestehenden Job gestartet werden",
    )


async def _bind_analyse_actor(
    payload: AnalyzeUrlRequest,
) -> tuple[Optional[str], Optional[str], Optional[str]]:
    job_id = _normalize_optional_job_id(payload.job_id)
    reject_unbound_user_analyse(job_id, payload.user_id)
    if not job_id:
        return None, None, None
    claimed = await claim_queued_analyse_job(job_id)
    if not claimed or not claimed.get("user_id"):
        raise HTTPException(404, "Job nicht gefunden")
    return job_id, str(claimed["user_id"]), job_expected_listing_id(claimed.get("listing_id"))


async def _bind_analyse_actor_limited(
    payload: AnalyzeUrlRequest,
) -> tuple[Optional[str], Optional[str], Optional[str]]:
    job_id, user_id, expected_listing_id = await _bind_analyse_actor(payload)
    try:
        _reject_analyse_burst(user_id)
    except HTTPException:
        if job_id:
            await _fail_job_or_log(
                job_id,
                user_id,
                "",
                "Zu viele Analyse-Anfragen. Bitte kurz warten.",
                "Zu viele Analyse-Anfragen. Bitte kurz warten.",
                step="failed",
            )
        raise
    return job_id, user_id, expected_listing_id


def _extract_listing_data(markdown: str, url: str) -> tuple[CustomListingExtraction, int]:
    client, model = get_langdock_client()
    result, completion = client.messages.create_with_completion(
        model=model,
        max_tokens=3072,
        response_model=CustomListingExtraction,
        messages=[
            {
                "role": "user",
                "content": (
                    "Extrahiere strukturierte Immobilien-Angebotsdaten aus dem folgenden "
                    "Markdown-Auszug einer Webseite, die MÖGLICHERWEISE eine "
                    "Immobilienanzeige ist (kann auch eine Suchergebnisliste, ein "
                    "News-Artikel, eine Startseite oder eine Bot-Wall-/Fehlerseite sein - "
                    "beliebige Website, nicht nur bekannte Portale).\n\n"
                    "Setze seiteninhalt_erkannt zuerst ehrlich: nur 'immobilienangebot', wenn "
                    "klar EINE konkrete Immobilie mit Angebotscharakter erkennbar ist.\n\n"
                    "REGEL: Halluziniere KEINE Werte. Fehlende Informationen → null. "
                    "Nur Fakten, die im Text/in Tabellen/Badges sichtbar sind.\n\n"
                    "Suche gezielt nach:\n"
                    "- preis (auch als Badge nahe Titel/Galerie oder in Detailtabelle "
                    "'Kaufpreis'/'Preis'/'Miete'; Kaltmiete als Monatswert, "
                    "nie Jahreskaltmiete)\n"
                    "- flaeche_m2 (Wohnfläche), grundstuecksflaeche_m2, nutzflaeche_m2\n"
                    "- zimmer, etage, anzahl_etagen, baujahr\n"
                    "- effizienzklasse, energieausweis_typ, endenergiebedarf_kwh\n"
                    "- heizung, denkmalschutz (bool), vermietet (bool)\n"
                    "- hausgeld_eur (Monat), kaltmiete_eur (Bestandsmiete falls genannt)\n"
                    "- zustand_kurz (nur wenn Anzeige einen Zustandsbegriff nennt)\n\n"
                    f"URL: {url}\n\n{markdown[:MAX_MARKDOWN_CHARS_FOR_EXTRACTION]}"
                ),
            }
        ],
    )
    usage = getattr(completion, "usage", None)
    tokens = int(getattr(usage, "input_tokens", 0) or 0) + int(
        getattr(usage, "output_tokens", 0) or 0
    )
    return result, tokens


def _apply_angebot_abgleich(
    extraction: CustomListingExtraction,
    gespeichert: Optional[str],
    text: str,
) -> bool:
    llm_typ = extraction.angebotstyp
    bestand = (gespeichert or "").strip() or None
    aligned_typ, aligned_preis = abgleich_angebot_extraktion(
        gespeichert, llm_typ, extraction.preis, text
    )
    rejected_flip = (
        llm_typ in ("kauf", "miete")
        and bestand in ("kauf", "miete")
        and llm_typ != bestand
        and aligned_typ == bestand
    )
    flipped = aligned_typ in ("kauf", "miete") and (
        (llm_typ in ("kauf", "miete") and aligned_typ != llm_typ)
        or (bestand in ("kauf", "miete") and aligned_typ != bestand)
    )
    extraction.angebotstyp = aligned_typ
    extraction.preis = float(aligned_preis) if aligned_preis is not None else None
    if flipped and aligned_typ == "kauf":
        extraction.kaltmiete_eur = None
    elif flipped and aligned_typ == "miete" and aligned_preis is not None:
        extraction.kaltmiete_eur = float(aligned_preis)
    return rejected_flip


def _extract_preis_fallback(
    raw_html: str,
    angebotstyp: Optional[str] = None,
) -> Optional[float]:
    """Fallback-Preisextraktion direkt aus raw_html, NUR wenn der
    Markdown-LLM-Call keinen Preis liefert. Root Cause: Firecrawls
    Markdown-Konvertierung verwirft bei manchen Portalen (v.a.
    kleinanzeigen.de) den UI-Preis-Badge nahe der Bildergalerie.

    Dieselbe Label-Logik wie die wöchentliche Nachprüfung: Kauf- und
    Mietbeträge nicht mischen, Hausgeld/Kaution/Stellplatz überspringen.
    Unbeschriftete Badges bleiben erlaubt (Kleinanzeigen).
    """
    if not raw_html:
        return None
    text = BeautifulSoup(raw_html, "html.parser").get_text(" ", strip=True)
    wert = preis_aus_text(
        text[:_PREIS_FALLBACK_TEXT_CHARS],
        angebotstyp,
        nur_beschriftet=False,
    )
    return float(wert) if wert is not None else None


def _image_dedup_key(url: str) -> str:
    return url.split("?")[0].strip().lower()


def _merge_bilder(html_bilder: list[str], llm_bilder: list[str]) -> list[str]:
    seen: set[str] = set()
    merged: list[str] = []
    for url in html_bilder + llm_bilder:
        raw = url.strip()
        key = _image_dedup_key(raw)
        if not key or key in seen:
            continue
        seen.add(key)
        merged.append(raw)
    return merged[:MAX_IMAGES_PER_LISTING]


async def _upload_and_store_images(listing_id: str, bilder: list[str]) -> int:
    """Lädt die von der KI erkannten Bild-URLs (Obergrenze
    MAX_IMAGES_PER_LISTING, um Kosten/Zeit zu begrenzen) parallel nach MinIO
    hoch und ersetzt real_estate_images für dieses Listing (Refresh derselben
    URL: alte Bilder werden vorher gelöscht, keine Duplikate). Ein leerer
    oder unvollständiger Upload lässt die bestehende Galerie unverändert.
    Best-effort: ein fehlgeschlagener Bild-Upload oder DB-Fehler darf die
    Analyse nicht zum Absturz bringen.

    Pfad-Präfix "real-estate/{listing_id}/foto_{position}.{ext}" statt des
    ZVG-spezifischen Pfads - reuse von upload_image() über dessen bereits
    vorhandenen listing_id-Branch (siehe scrapers/src/storage/minio.py).
    """
    limited = bilder[:MAX_IMAGES_PER_LISTING]
    if not limited:
        return 0

    results = await asyncio.gather(
        *[
            upload_image(
                url, bundesland="", slug="", listing_id=f"real-estate/{listing_id}", position=i
            )
            for i, url in enumerate(limited)
        ],
        return_exceptions=True,
    )

    images: list[tuple[str, str, int]] = []
    for i, r in enumerate(results):
        if isinstance(r, Exception) or r is None:
            logger.warning(
                f"Bild {i} für Listing {listing_id} konnte nicht hochgeladen werden: {r}"
            )
            continue
        storage_path, public_url = r
        images.append((storage_path, public_url, i))

    if not images:
        return 0
    if len(images) != len(limited):
        existing = await count_real_estate_images(listing_id)
        if existing > 0:
            logger.warning(
                f"Bild-Refresh abgebrochen ({len(images)}/{len(limited)} ok) — "
                f"bestehende Galerie für {listing_id} bleibt erhalten"
            )
            return 0
        logger.warning(
            f"Teilgalerie gespeichert ({len(images)}/{len(limited)}) — "
            f"Listing {listing_id} hatte noch keine Fotos"
        )

    try:
        await replace_real_estate_images(listing_id, images)
        return len(images)
    except Exception as e:
        logger.warning(
            f"Speichern der Bild-Metadaten fehlgeschlagen (listing_id={listing_id}): {e}"
        )
        return 0


def _sum_fix_flip_kosten(massnahmen: list[FixFlipMassnahme]) -> tuple[Optional[int], Optional[int]]:
    """Summiert die Fix&Flip-Einzelmaßnahmen SERVERSEITIG (NICHT von der KI
    selbst addieren lassen, um Rechenfehler auszuschließen). Pendant zu
    src/flows/ki_analysis.py::_sum_fix_flip_kosten (bewusst dupliziert statt
    domänenübergreifend geteilt, siehe Domain-Trennung in models/real_estate.py)."""
    mins = [m.kosten_min_eur for m in massnahmen if m.kosten_min_eur is not None]
    maxs = [m.kosten_max_eur for m in massnahmen if m.kosten_max_eur is not None]
    return (sum(mins) if mins else None, sum(maxs) if maxs else None)


def _estimate_fix_flip_arv(
    extraction: CustomListingExtraction,
    massnahmen: list[FixFlipMassnahme],
    fix_flip_min: Optional[int],
    fix_flip_max: Optional[int],
) -> FixFlipDealSchaetzung:
    """Zweiter, kleiner LLM-Call (Ziel 6) - schätzt NUR ARV/Haltezeit/
    Konfidenz. NUR aufgerufen, wenn fix_flip_massnahmen nicht leer ist
    (siehe analyze_url) - spart Kosten/Latenz bei Angeboten ohne erkennbaren
    Sanierungsbedarf."""
    client, model = get_langdock_client()
    massnahmen_json = json.dumps([m.model_dump() for m in massnahmen], ensure_ascii=False)
    return client.messages.create(
        model=model,
        max_tokens=1024,
        response_model=FixFlipDealSchaetzung,
        messages=[
            {
                "role": "user",
                "content": (
                    "Schätze den Verkaufswert NACH Sanierung (After-Repair-Value, ARV) für "
                    "folgendes Angebot, das laut Beschreibung die unten genannten "
                    "Sanierungsmaßnahmen benötigt. Berücksichtige Lage, Größe, Zustand NACH "
                    "Sanierung und übliche Marktpreise/m² in der Region. Sei transparent, "
                    "wenn die Schätzung unsicher ist (arv_konfidenz) - erfinde keine "
                    "Vergleichspreise, die du nicht seriös begründen kannst.\n\n"
                    f"Kaufpreis (IST-Zustand): {extraction.preis} EUR\n"
                    f"Fläche: {extraction.flaeche_m2} m²\n"
                    f"Adresse: {extraction.adresse}, {extraction.plz} {extraction.ort}\n"
                    f"Baujahr: {extraction.baujahr}\n"
                    f"Objekttyp: {extraction.typ}\n"
                    f"Geplante Sanierungsmaßnahmen: {massnahmen_json}\n"
                    f"Geschätzte Sanierungskosten gesamt: {fix_flip_min} – {fix_flip_max} EUR\n"
                ),
            }
        ],
    )


def _estimate_and_calc_fix_flip_deal(
    extraction: CustomListingExtraction,
    massnahmen: list[FixFlipMassnahme],
    fix_flip_min: Optional[int],
    fix_flip_max: Optional[int],
) -> Optional[dict]:
    """Liefert die geschätzten Flip-Fakten (ARV, Haltedauer, Konfidenz).

    Die Euro-Beträge dazu wurden hier früher berechnet und gespeichert. Sie
    kommen jetzt aus apps/web/lib/underwriting, damit ZVG- und Marktobjekte
    dieselbe Rechnung sehen; siehe denselben Umbau in
    src/flows/ki_analysis.py::_berechne_fix_flip_deal_felder.
    """
    if not extraction.preis:
        return None
    arv = _estimate_fix_flip_arv(extraction, massnahmen, fix_flip_min, fix_flip_max)
    return {
        "arv_min_eur": arv.arv_min_eur,
        "arv_max_eur": arv.arv_max_eur,
        "arv_begruendung": arv.arv_begruendung,
        "arv_konfidenz": arv.arv_konfidenz,
        "holding_monate": arv.holding_monate,
    }


def _analyze_market_fairness(
    extraction: CustomListingExtraction,
) -> tuple[CustomMarketAnalyse, int]:
    client, model = get_langdock_client()
    preis_zeile = (
        f"Kaltmiete EUR/Monat: {extraction.preis}\n"
        if extraction.angebotstyp == "miete"
        else f"Kaufpreis EUR: {extraction.preis}\n"
    )
    angebot_text = (
        f"Titel: {extraction.titel}\n"
        f"Objekttyp: {extraction.typ}\n"
        f"Angebotstyp: {extraction.angebotstyp}\n"
        f"{preis_zeile}"
        f"Wohnfläche: {extraction.flaeche_m2} m²\n"
        f"Grundstück: {extraction.grundstuecksflaeche_m2} m²\n"
        f"Nutzfläche: {extraction.nutzflaeche_m2} m²\n"
        f"Zimmer: {extraction.zimmer}\n"
        f"Etage: {extraction.etage} / Etagen gesamt: {extraction.anzahl_etagen}\n"
        f"Adresse: {extraction.adresse}, {extraction.plz} {extraction.ort}\n"
        f"Baujahr: {extraction.baujahr}\n"
        f"Effizienzklasse: {extraction.effizienzklasse}\n"
        f"Energieausweis-Typ: {extraction.energieausweis_typ}\n"
        f"Endenergie kWh: {extraction.endenergiebedarf_kwh}\n"
        f"Heizung: {extraction.heizung}\n"
        f"Denkmalschutz: {extraction.denkmalschutz}\n"
        f"Vermietet: {extraction.vermietet}\n"
        f"Hausgeld EUR/Monat: {extraction.hausgeld_eur}\n"
        f"Bestands-Kaltmiete EUR/Monat: {extraction.kaltmiete_eur}\n"
        f"Zustand (Anzeige): {extraction.zustand_kurz}\n"
        f"Beschreibung: {extraction.beschreibung}\n"
    )
    result, completion = client.messages.create_with_completion(
        model=model,
        max_tokens=MAX_MARKET_ANALYSIS_TOKENS,
        response_model=CustomMarketAnalyse,
        messages=[
            {
                "role": "user",
                "content": (
                    "Du bist ein unabhängiger Immobilien-Marktanalyst UND Investment-Berater. "
                    "Bewerte das folgende MARKT-Angebot (keine Zwangsversteigerung, kein Gutachten).\n\n"
                    "HARTREGEL: Nur aus Anzeigentext/sichtbaren Fakten. Fehlend → null oder []. "
                    "Keine Gutachten-Halluzinationen (kein Grundbuch, keine Belastungen, "
                    "keine Bietgrenzen, keine erfundenen BRW-/Ertragswerte).\n\n"
                    "1. Markt-Fairness: preis_bewertung, Abweichung, staerken/schwaechen, "
                    "lage_bewertung, zusammenfassung. rendite_geschaetzt_pct NUR bei "
                    "angebotstyp=kauf mit Vermietbarkeit (Jahreskaltmiete/Kaufpreis), sonst null.\n"
                    "2. Investoren-Perspektive: NUR bei angebotstyp=kauf: investment_score + "
                    "Begründung, risiken_investor, cashflow_einschaetzung (nur mit "
                    "Vermietbarkeit). Bei Miete oder unklarem Typ: alle vier null bzw. [].\n"
                    "3. Fix & Flip: NUR bei angebotstyp=kauf und konkreten Renovierungshinweisen "
                    "im Text. Bei Miete oder unklarem Typ: fix_flip_massnahmen = []. "
                    "Im Zweifel leere Liste.\n"
                    "4. Strukturierte Objekt-Infos (nur wenn Text stützt):\n"
                    "   - maengel (strukturiert), modernisierungen (Jahr+Text)\n"
                    "   - energieausweis_* / heizung / zustand_aussen/innen / maengel_kurz\n"
                    "   - baubeschreibung, instandhaltung (aus Anzeigentext, nicht erfinden)\n"
                    "   - lage_einwohner/region/verkehr/charakter/umgebung (strukturiert, "
                    "zusätzlich zu lage_bewertung; null wenn unsicher)\n"
                    "   - moegliche_kaltmiete + hausgeld (EUR/Monat): Bestandswerte aus Extraktion "
                    "übernehmen wenn vorhanden, sonst nur grob schätzen wenn seriös möglich\n"
                    "   - bodenrichtwert_* nur bei seriöser Ableitbarkeit, sonst null\n"
                    "   - jahresrohertrag/liegenschaftszinssatz/ertragswert nur bei "
                    "angebotstyp=kauf und wenn belastbar, sonst null\n\n"
                    f"{angebot_text}"
                ),
            }
        ],
    )
    usage = getattr(completion, "usage", None)
    tokens = int(getattr(usage, "input_tokens", 0) or 0) + int(
        getattr(usage, "output_tokens", 0) or 0
    )
    return result, tokens


def _custom_listing_gate_dict(extraction: CustomListingExtraction) -> dict:
    return {
        "existing_analysis": {
            "maengel_kurz": extraction.zustand_kurz or "",
            "instandhaltung": (extraction.beschreibung or "")[:2000],
        },
    }


def _without_purchase_underwriting(analyse: CustomMarketAnalyse) -> CustomMarketAnalyse:
    """Miete/unklarer Typ: keine Kauf-Underwriting-Felder persistieren."""
    return analyse.model_copy(
        update={
            "rendite_geschaetzt_pct": None,
            "investment_score": None,
            "investment_score_begruendung": None,
            "risiken_investor": [],
            "cashflow_einschaetzung": None,
            "fix_flip_massnahmen": [],
            "fix_flip_werteinschaetzung": None,
            "jahresrohertrag": None,
            "liegenschaftszinssatz": None,
            "ertragswert": None,
        }
    )


def _plausible_preis_abweichung(analyse: CustomMarketAnalyse) -> CustomMarketAnalyse:
    """Begrenzt offensichtlich spekulative Markt-Prozentwerte."""
    updates: dict = {}
    if analyse.preis_abweichung_pct is not None and abs(analyse.preis_abweichung_pct) > 60:
        updates["preis_abweichung_pct"] = None
    if analyse.rendite_geschaetzt_pct is not None and (
        analyse.rendite_geschaetzt_pct < 0 or analyse.rendite_geschaetzt_pct > 20
    ):
        updates["rendite_geschaetzt_pct"] = None
    if not updates:
        return analyse
    return analyse.model_copy(update=updates)


def _build_manual_page_result(
    url: str,
    domain: str,
    content: str,
    *,
    fetch_source: str,
    is_html: bool,
    min_chars: int,
    insufficient_message: str,
) -> ResilientScrapeResult:
    """Baut ein Fetch-Ergebnis für HTML-Einfügung/PDF-Upload (Phase 3) - ohne
    Netzwerk-Fetch, damit die restliche Pipeline (Slicing, Extraktion, Bild-
    erkennung, Preis-Fallback) unverändert weiterläuft."""
    raw_html = content if is_html else ""
    markdown = html_to_markdown(content) if is_html else content
    success = len((markdown or "").strip()) >= min_chars
    return ResilientScrapeResult(
        url=url,
        markdown=markdown,
        raw_html=raw_html,
        success=success,
        error=None if success else insufficient_message,
        error_code=None if success else "SCRAPE_INSUFFICIENT",
        metadata=ScrapeMetadata(domain=domain, fetch_source=fetch_source),
    )


def _resolve_reference_url(url: Optional[str]) -> Optional[str]:
    """Optionale Referenz-URL bei HTML-/PDF-Einreichung: kein Fetch, aber
    dieselbe öffentliche https-Regel inkl. DNS wie beim Live-Pfad, damit eine
    spätere Anzeige/Re-Analyse nie eine interne Adresse als Quelle übernimmt."""
    if not url or not isinstance(url, str) or not url.strip():
        return None
    candidate = _normalize_source_url(url.strip())
    try:
        return assert_public_http_url(candidate, require_https=True, resolve_dns=True)
    except UrlSafetyError:
        return None


def _require_reference_url(url: Optional[str]) -> Optional[str]:
    """Wie _resolve_reference_url, wirft aber wenn eine URL angegeben und ungültig ist."""
    if not url or not isinstance(url, str) or not url.strip():
        return None
    resolved = _resolve_reference_url(url)
    if resolved is None:
        raise HTTPException(422, "Referenz-URL ist ungültig oder nicht öffentlich erreichbar")
    return resolved


def _analysis_peek_metadata(content_mode: str, cookie_header: Optional[str]) -> dict:
    if content_mode == "html":
        return {"fetch_source": "manual_html"}
    if content_mode == "pdf":
        return {"fetch_source": "manual_pdf"}
    if cookie_header:
        return {"fetch_source": "http", "session_cookie_used": True}
    return {"fetch_source": "http"}


async def run_custom_url_analysis(
    url: Optional[str] = None,
    user_id: Optional[str] = None,
    job_id: Optional[str] = None,
    *,
    manual_html: Optional[str] = None,
    manual_pdf_base64: Optional[str] = None,
    cookie_header: Optional[str] = None,
    log_request: bool = True,
    expected_listing_id: Optional[str] = None,
) -> AnalyzeUrlResponse:
    token = _LOG_CUSTOM_URL_REQUEST.set(log_request)
    try:
        return await _execute_custom_url_analysis(
            url,
            user_id,
            job_id,
            manual_html=manual_html,
            manual_pdf_base64=manual_pdf_base64,
            cookie_header=cookie_header,
            expected_listing_id=expected_listing_id,
        )
    finally:
        _LOG_CUSTOM_URL_REQUEST.reset(token)


async def _execute_custom_url_analysis(
    url: Optional[str] = None,
    user_id: Optional[str] = None,
    job_id: Optional[str] = None,
    *,
    manual_html: Optional[str] = None,
    manual_pdf_base64: Optional[str] = None,
    cookie_header: Optional[str] = None,
    expected_listing_id: Optional[str] = None,
) -> AnalyzeUrlResponse:
    """Kanonische Custom-URL-Analyse-Logik (Fetch/HTML-Einfügung/PDF-Upload +
    Extraktion + Markt-/Investment-Analyse + Fix&Flip + DB-Upsert + Bild-
    Upload). Mit job_id: Progress-Updates in custom_url_requests; ohne:
    Sync-Logging wie bisher.

    Phase 3 (private/login-geschützte Angebote, siehe docs/CUSTOM_URL_ANALYSIS.md):
    - `manual_html` ODER `manual_pdf_base64` ersetzen den Live-Fetch komplett
      (kein Netzwerk-Request an `url` - die dient dann nur als optionale
      Referenz/Link zur Originalanzeige).
    - `cookie_header` ist NUR beim Live-Fetch relevant: ein vom Nutzer
      EXPLIZIT eingefügter Opt-in-Session-Cookie (kein automatisches/stilles
      Credential-Scraping) für einen isolierten, nicht persistierten Fetch
      (siehe scrape_ladder.fetch_page_resilient)."""
    content_mode = "pdf" if manual_pdf_base64 else ("html" if manual_html else "live")

    if content_mode == "live":
        if not url:
            msg = "URL fehlt"
            return await _fail_job_or_log(job_id, user_id, "", msg, msg, step="failed")
        url = _normalize_source_url(url)
        try:
            url = assert_analyse_listing_url(url)
        except UrlSafetyError as e:
            msg = public_url_safety_message(e)
            return await _fail_job_or_log(
                job_id,
                user_id,
                url,
                msg,
                msg,
                step="failed",
                error_code=url_safety_error_code(e),
            )
    else:
        url = _resolve_reference_url(url) or build_manual_reference_url(
            content_mode, manual_html or manual_pdf_base64 or ""
        )

    domain = urlparse(url).netloc or "custom"
    safe_url = log_safe_url(url)
    tokens_used = 0
    current_step = "queued"
    peek_meta = _analysis_peek_metadata(content_mode, cookie_header)
    stored_typ, previous_loc, existing_listing_id = await peek_existing_real_estate_state(
        url, domain, user_id, peek_meta, expected_listing_id=expected_listing_id
    )
    gone = await _fail_if_refresh_target_gone(
        job_id,
        user_id,
        url,
        existing_listing_id,
        expected_listing_id,
        step="failed",
    )
    if gone:
        return gone
    if job_id and existing_listing_id:
        await _set_job_progress(job_id, listing_id=existing_listing_id)

    async def _detail(msg: str, *, kind: str = "line", **kwargs) -> None:
        await _set_job_progress(job_id, step_detail=msg, kind=kind, **kwargs)

    async def _chapter(name: str) -> None:
        await _set_job_progress(job_id, step_detail=name, kind="chapter")

    async def _fetch_progress(msg: str) -> None:
        await _detail(_map_fetch_progress(msg))

    if job_id:
        await _set_job_progress(
            job_id,
            status="running",
            step="fetching",
            progress_pct=15,
            step_detail="Analyse gestartet",
        )
        current_step = "fetching"
        await _chapter("FETCH")
        await _detail("Exposé wird geladen…")

    if content_mode == "live":
        extra_cookies = None
        if cookie_header:
            try:
                extra_cookies = parse_cookie_header(cookie_header, urlparse(url).hostname or domain)
            except ManualContentError as e:
                msg = str(e)
                return await _fail_job_or_log(
                    job_id, user_id, url, msg, msg, step=current_step if job_id else "failed"
                )
            await _detail("Eingefügte Sitzung wird verwendet (nicht gespeichert)")
            logger.info(
                f"Custom-URL {safe_url}: opt-in session cookie used "
                f"user={user_id or '-'} domain={domain} cookies={len(extra_cookies)}"
            )

        try:
            await assert_no_unsafe_redirect(url, require_https=True)
        except UrlSafetyError as e:
            msg = public_url_safety_message(e)
            return await _fail_job_or_log(
                job_id,
                user_id,
                url,
                msg,
                msg,
                step=current_step if job_id else "failed",
                error_code=url_safety_error_code(e),
            )

        try:
            async with _job_heartbeat(job_id, "Seite wird geladen", "fetch"):
                page = await fetch_page_resilient(
                    url,
                    on_progress=_fetch_progress if job_id else None,
                    extra_cookies=extra_cookies,
                )
        except Exception as e:
            logger.error(f"Custom-URL-Fetch fehlgeschlagen ({safe_url}): {e}")
            return await _fail_job_or_log(
                job_id,
                user_id,
                url,
                f"Seite konnte nicht geladen werden: {e}",
                (
                    "Die Seite konnte nicht geladen werden (z.B. Zugriffsschutz, Timeout oder "
                    "nicht erreichbar). Bitte URL prüfen oder später erneut versuchen."
                ),
                step=current_step if job_id else "failed",
            )
    elif content_mode == "html":
        await _detail("Eingefügter HTML-Inhalt wird verarbeitet…")
        page = _build_manual_page_result(
            url,
            domain,
            manual_html[:MAX_MANUAL_HTML_CHARS],
            fetch_source="manual_html",
            is_html=True,
            min_chars=MIN_MARKDOWN_CHARS,
            insufficient_message=(
                "Der eingefügte HTML-Inhalt enthält zu wenig auswertbaren Text. "
                "Bitte den vollständigen Seitenquelltext der Anzeige einfügen."
            ),
        )
    else:
        try:
            pdf_bytes = decode_pdf_base64(manual_pdf_base64)
        except ManualContentError as e:
            msg = str(e)
            return await _fail_job_or_log(
                job_id, user_id, url, msg, msg, step=current_step if job_id else "failed"
            )
        await _detail("PDF wird gelesen…")
        try:
            async with _job_heartbeat(job_id, "PDF wird gelesen…", "fetch"):
                pdf_text = await asyncio.to_thread(extract_pdf_text, pdf_bytes)
        except Exception as e:
            logger.error(f"Custom-PDF-Textextraktion fehlgeschlagen: {e}")
            msg = "Text konnte nicht aus dem PDF extrahiert werden."
            return await _fail_job_or_log(
                job_id, user_id, url, msg, msg, step=current_step if job_id else "failed"
            )
        page = _build_manual_page_result(
            url,
            domain,
            pdf_text,
            fetch_source="manual_pdf",
            is_html=False,
            min_chars=MIN_MANUAL_PDF_TEXT_CHARS,
            insufficient_message=(
                "Das PDF enthält keinen auswertbaren Text (z.B. eingescannt ohne Texterkennung). "
                "Bitte den Anzeigentext stattdessen über HTML-Einfügung übertragen."
            ),
        )

    if not page.success or len(page.markdown) < 100:
        err_code = page.error_code or "SCRAPE_INSUFFICIENT"
        err_msg = page.error or (
            "Auf dieser Seite konnten keine verwertbaren Inhalte gefunden werden "
            "(z.B. Zugriffsschutz oder Login-Sperre). Bitte eine andere URL versuchen."
        )
        logger.warning(
            f"Custom-URL-Fetch unzureichend ({safe_url}): code={err_code} len={len(page.markdown)}"
        )
        return await _fail_job_or_log(
            job_id,
            user_id,
            url,
            f"{err_code}: {err_msg}",
            err_msg,
            step=current_step if job_id else "failed",
        )

    source = getattr(page.metadata, "fetch_source", None) or "http"
    await _detail("Seite geladen")

    sliced = slice_listing_content(page.raw_html, url)
    extraction_input = sliced.text if sliced.success else page.markdown
    logger.info(
        f"Custom-URL {safe_url}: extraction_input_chars={len(extraction_input)} "
        f"(markdown_chars={len(page.markdown)}, source={sliced.source}, "
        f"json_ld_used={sliced.json_ld_used}, slice_success={sliced.success}, "
        f"fetch_source={source})"
    )
    await _detail("Inhalt vorbereitet")

    current_step = "extracting"
    await _chapter("EXTRACT")
    await _set_job_progress(
        job_id,
        step="extracting",
        progress_pct=40,
        step_detail="Objektdaten werden extrahiert…",
    )

    try:
        async with _job_heartbeat(job_id, "Objektdaten werden extrahiert…", "extract"):
            extraction, extract_tokens = await asyncio.to_thread(
                _extract_listing_data, extraction_input, url
            )
            tokens_used += extract_tokens
    except AnthropicRateLimitError as e:
        logger.warning(f"Custom-URL-Extraktion: Anfragelimit erreicht ({safe_url}): {e}")
        return await _fail_job_or_log(
            job_id,
            user_id,
            url,
            "RATE_LIMITED: Anfragelimit für KI-Analysen erreicht",
            "Anfragelimit für KI-Analysen erreicht. Bitte in einigen Minuten erneut versuchen.",
            step=current_step if job_id else "failed",
            error_code="RATE_LIMITED",
        )
    except Exception as e:
        logger.error(f"Custom-URL-Extraktion fehlgeschlagen ({safe_url}): {e}")
        return await _fail_job_or_log(
            job_id,
            user_id,
            url,
            f"Datenextraktion fehlgeschlagen: {e}",
            "Die Angebotsdaten konnten nicht zuverlässig extrahiert werden. Bitte URL prüfen.",
            step=current_step if job_id else "failed",
        )

    if extraction.seiteninhalt_erkannt == "kein_immobilienangebot":
        logger.info(f"Custom-URL {safe_url}: kein Immobilienangebot erkannt (seiteninhalt_erkannt)")
        return await _fail_job_or_log(
            job_id,
            user_id,
            url,
            "Kein Immobilienangebot erkannt",
            (
                "Diese Seite scheint keine einzelne Immobilien-Anzeige zu sein (z.B. Suchliste, "
                "Startseite oder Artikel). Bitte den Link zu einem konkreten Angebot verwenden."
            ),
            step=current_step if job_id else "failed",
        )

    scrape_meta = page.metadata.to_dict() if page.metadata else None
    stored_typ, previous_loc, existing_listing_id = await peek_existing_real_estate_state(
        url, domain, user_id, scrape_meta, expected_listing_id=expected_listing_id
    )
    gone = await _fail_if_refresh_target_gone(
        job_id,
        user_id,
        url,
        existing_listing_id,
        expected_listing_id,
        step=current_step if job_id else "failed",
    )
    if gone:
        return gone
    if job_id and existing_listing_id:
        await _set_job_progress(job_id, listing_id=existing_listing_id)
    if existing_listing_id and extraction.seiteninhalt_erkannt != "immobilienangebot":
        logger.info(
            f"Custom-URL {safe_url}: Refresh abgebrochen "
            f"(seiteninhalt_erkannt={extraction.seiteninhalt_erkannt})"
        )
        return await _fail_job_or_log(
            job_id,
            user_id,
            url,
            "Refresh abgebrochen: kein belastbares Exposé",
            (
                "Die Anzeige konnte nicht erneut gelesen werden (Login-Sperre oder unklarer Inhalt). "
                "Der gespeicherte Stand bleibt unverändert. Bitte später erneut versuchen "
                "oder HTML-Einfügung/Cookie nutzen."
            ),
            step=current_step if job_id else "failed",
            error_code="SCRAPE_INSUFFICIENT",
        )
    rejected_flip = _apply_angebot_abgleich(
        extraction,
        stored_typ,
        extraction_input or page.markdown or page.raw_html or "",
    )

    if extraction.preis is None and page.raw_html and not rejected_flip:
        fallback_preis = _extract_preis_fallback(page.raw_html, extraction.angebotstyp)
        if fallback_preis is not None:
            logger.info(
                f"Custom-URL {safe_url}: Preis via raw_html-Fallback ermittelt ({fallback_preis})"
            )
            extraction.preis = fallback_preis
            await _detail(f"Preis ergänzt: {int(fallback_preis):,} €".replace(",", "."))

    if not extraction.preis and not extraction.beschreibung:
        logger.info(f"Custom-URL {safe_url}: keine verwertbaren Angebotsdaten erkannt")
        return await _fail_job_or_log(
            job_id,
            user_id,
            url,
            "Keine verwertbaren Angebotsdaten erkannt",
            (
                "Auf dieser Seite wurden keine erkennbaren Immobilien-Angebotsdaten gefunden. "
                "Bitte prüfen, ob es sich um eine einzelne Angebotsseite handelt."
            ),
            step=current_step if job_id else "failed",
        )

    preis_pro_m2 = None
    if (
        extraction.preis is not None
        and extraction.flaeche_m2 is not None
        and extraction.flaeche_m2 > 0
    ):
        preis_pro_m2 = round(extraction.preis / extraction.flaeche_m2)

    preview_base: dict = {
        "typ": extraction.typ,
        "preis": extraction.preis,
        "zimmer": extraction.zimmer,
        "flaecheM2": extraction.flaeche_m2,
        "preisProM2": preis_pro_m2,
        "ort": extraction.ort,
        "angebotstyp": extraction.angebotstyp,
    }

    html_bilder = extract_listing_images(page.raw_html, url, limit=MAX_IMAGES_PER_LISTING)
    llm_bilder_count = len(extraction.bilder)
    extraction.bilder = _merge_bilder(html_bilder, extraction.bilder)
    if extraction.bilder:
        logger.info(
            f"Custom-URL {safe_url}: {len(extraction.bilder)} Bilder "
            f"(html={len(html_bilder)}, llm={llm_bilder_count})"
        )
        preview_base["bildCount"] = len(extraction.bilder)
        await _detail(f"{len(extraction.bilder)} Fotos gefunden", kind="teaser")

    await _set_job_progress(job_id, preview=preview_base)

    try:
        angebotstyp = extraction.angebotstyp
        preview_base["angebotstyp"] = angebotstyp
        if extraction.preis is not None:
            bits = [f"{int(extraction.preis):,} €".replace(",", ".")]
            if angebotstyp == "miete":
                bits[0] += " / Monat"
            if extraction.zimmer:
                bits.append(f"{extraction.zimmer:g} Zi")
            if extraction.flaeche_m2:
                bits.append(f"{extraction.flaeche_m2:g} m²")
            await _detail(" · ".join(bits), kind="teaser")
        else:
            await _detail("Preis fehlt · Beschreibung vorhanden", kind="teaser")
            logger.warning(
                f"Custom-URL {safe_url} ({domain}): Preis fehlt trotz vorhandener Beschreibung"
            )
        await _set_job_progress(job_id, preview=preview_base)

        geo_adresse, geo_plz, geo_ort = coherent_location(
            (
                _blank_to_none(extraction.adresse),
                _blank_to_none(extraction.plz),
                _blank_to_none(extraction.ort),
            ),
            previous_loc,
        )
        extraction.adresse = geo_adresse
        extraction.plz = geo_plz
        extraction.ort = geo_ort
        preview_base["ort"] = geo_ort
        lat_lng: Optional[tuple[float, float]] = None
        clear_geo = False
        try:
            lat_lng = await geocode_with_fallback(
                adresse=geo_adresse,
                plz=geo_plz,
                ort=geo_ort,
                countrycodes=None,
                country_label=None,
            )
            if lat_lng:
                logger.info(f"Custom-URL {safe_url}: geocodiert → {lat_lng}")
                await _detail("Standort bestimmt")
            else:
                if previous_loc and location_identity(*previous_loc) != location_identity(
                    geo_adresse, geo_plz, geo_ort
                ):
                    clear_geo = True
                    await _detail("Standort veraltet · Karte entfernt")
                else:
                    await _detail("Standort ungenau · weiter ohne Karte")
        except Exception as e:
            logger.warning(f"Custom-URL-Geocoding fehlgeschlagen ({safe_url}): {e}")
            if previous_loc and location_identity(*previous_loc) != location_identity(
                geo_adresse, geo_plz, geo_ort
            ):
                clear_geo = True
                await _detail("Standort veraltet · Karte entfernt")
            else:
                await _detail("Standort nicht bestimmbar")

        current_step = "market"
        await _chapter("MARKET")
        await _set_job_progress(
            job_id,
            step="market",
            progress_pct=60,
            step_detail="Marktpreis wird geprüft…",
        )

        async with _job_heartbeat(job_id, "Marktpreis wird geprüft…", "market"):
            analyse, market_tokens = await asyncio.to_thread(_analyze_market_fairness, extraction)
            tokens_used += market_tokens
        analyse = _plausible_preis_abweichung(analyse)
        if analyse.effizienzklasse is None and extraction.effizienzklasse:
            analyse.effizienzklasse = extraction.effizienzklasse
        if analyse.endenergieverbrauch_kwh is None and extraction.endenergiebedarf_kwh:
            analyse.endenergieverbrauch_kwh = extraction.endenergiebedarf_kwh
        if analyse.heizung is None and extraction.heizung:
            analyse.heizung = extraction.heizung
        if analyse.hausgeld is None and extraction.hausgeld_eur:
            analyse.hausgeld = extraction.hausgeld_eur
        if analyse.moegliche_kaltmiete is None and extraction.kaltmiete_eur:
            analyse.moegliche_kaltmiete = extraction.kaltmiete_eur
        if analyse.energieausweis_vorhanden is None and extraction.effizienzklasse:
            analyse.energieausweis_vorhanden = True

        if not has_documented_renovation_need(_custom_listing_gate_dict(extraction)):
            analyse = analyse.model_copy(
                update={"fix_flip_massnahmen": [], "fix_flip_werteinschaetzung": None}
            )

        is_kauf = angebotstyp == "kauf"
        if not is_kauf:
            analyse = _without_purchase_underwriting(analyse)

        fair = getattr(analyse, "preis_bewertung", None)
        score = getattr(analyse, "investment_score", None)
        fair_l = _fairness_label(fair)
        inv_l = _investment_label(score) if is_kauf else None
        teaser_bits = [f"Preis: {fair_l}"]
        if inv_l:
            teaser_bits.append(f"Investment {inv_l}")
        await _detail(" · ".join(teaser_bits), kind="teaser")
        await _set_job_progress(
            job_id,
            preview={
                "preisBewertung": fair,
                "investmentScore": score if inv_l else None,
            },
        )

        current_step = "investment"
        await _chapter("DEAL")
        await _set_job_progress(
            job_id,
            step="investment",
            progress_pct=80,
            step_detail="Rendite und Potenzial…"
            if is_kauf
            else "Mietangebot · keine Kauf-Rechnung",
        )

        fix_flip_min, fix_flip_max = None, None
        fix_flip_deal = None
        if not is_kauf:
            await _detail("Mietangebot · keine Kauf-Rechnung", kind="teaser")
        elif analyse.fix_flip_massnahmen:
            fix_flip_min, fix_flip_max = _sum_fix_flip_kosten(analyse.fix_flip_massnahmen)
            await _detail("Sanierungsbedarf erkannt")
            try:
                async with _job_heartbeat(job_id, "Sanierungskosten werden geschätzt…", "flip"):
                    fix_flip_deal = await asyncio.to_thread(
                        _estimate_and_calc_fix_flip_deal,
                        extraction,
                        analyse.fix_flip_massnahmen,
                        fix_flip_min,
                        fix_flip_max,
                    )
                if fix_flip_deal and fix_flip_deal.get("arv_begruendung"):
                    analyse.fix_flip_werteinschaetzung = fix_flip_deal["arv_begruendung"]
                await _detail("Sanierungskosten geschätzt", kind="teaser")
            except Exception as e:
                logger.warning(f"Fix&Flip-Deal-Kalkulation fehlgeschlagen ({safe_url}): {e}")
                await _detail("Sanierungsschätzung übersprungen")
        else:
            await _detail("Kein größerer Sanierungsbedarf", kind="teaser")

        orte_payload: list = []
        if lat_lng:
            try:
                orte = await get_nearby_pois(lat_lng[0], lat_lng[1])
                orte_payload = [o.model_dump() for o in orte]
                if orte_payload:
                    await _detail("Umgebung erfasst")
            except Exception as e:
                logger.warning(f"POI-Abruf fehlgeschlagen ({safe_url}): {e}")

        _, model = get_langdock_client()
        try:
            (
                listing_id,
                _persisted_loc,
                persisted_angebotstyp,
            ) = await persist_custom_url_listing_and_ki(
                extraction,
                source_url=url,
                source=domain,
                user_id=user_id,
                scrape_metadata=scrape_meta,
                expected_listing_id=expected_listing_id,
                analyse=analyse,
                model_used=model,
                tokens_used=tokens_used,
                fix_flip_gesamtkosten_min_eur=fix_flip_min,
                fix_flip_gesamtkosten_max_eur=fix_flip_max,
                fix_flip_deal=fix_flip_deal,
                orte_in_der_naehe=orte_payload,
                lat_lng=lat_lng,
                clear_geo=clear_geo,
            )
        except RealEstateListingGoneError:
            return await _fail_job_or_log(
                job_id,
                user_id,
                url,
                "Refresh abgebrochen: Listing gelöscht",
                (
                    "Das gespeicherte Angebot ist nicht mehr vorhanden. "
                    "Es wurde nichts neu angelegt."
                ),
                step=current_step if job_id else "failed",
                error_code="LISTING_GONE",
            )
        angebotstyp = persisted_angebotstyp or extraction.angebotstyp
        preview_base["angebotstyp"] = angebotstyp
        await _set_job_progress(job_id, preview=preview_base)
        await _detail("Objekt angelegt", listing_id=listing_id)
        await _detail("Analyse gespeichert")

        current_step = "images"
        n_bilder = len(extraction.bilder)
        await _chapter("IMAGES")
        await _set_job_progress(
            job_id,
            step="images",
            progress_pct=90,
            step_detail=(
                f"{n_bilder} Fotos werden gespeichert…" if n_bilder else "Keine Fotos · überspringe"
            ),
        )

        stored = 0
        try:
            if n_bilder:
                async with _job_heartbeat(
                    job_id, f"{n_bilder} Fotos werden gespeichert…", "images"
                ):
                    stored = await _upload_and_store_images(listing_id, extraction.bilder)
                if stored:
                    await _detail(f"{stored} Fotos gespeichert")
                else:
                    await _detail("Keine Fotos gespeichert · Galerie unverändert")
            preview_base["bildCount"] = await count_real_estate_images(listing_id)
            await _set_job_progress(job_id, preview=preview_base)
        except Exception as e:
            logger.warning(f"Bild-Upload-Pipeline fehlgeschlagen (listing_id={listing_id}): {e}")
            await _detail("Fotos teilweise übersprungen")
            preview_base["bildCount"] = await count_real_estate_images(listing_id)
            await _set_job_progress(job_id, preview=preview_base)

        verdict_bits = []
        if fair_l and fair_l != "noch unklar":
            verdict_bits.append(fair_l)
        if inv_l:
            verdict_bits.append(f"Investment {inv_l}")
        if extraction.ort:
            verdict_bits.append(extraction.ort)
        verdict = " · ".join(verdict_bits) if verdict_bits else "Fertig"

        if job_id:
            await _detail("Fertig", kind="verdict")
            await _detail(verdict, kind="verdict")
            await _set_job_progress(
                job_id,
                status="success",
                step="done",
                progress_pct=100,
                listing_id=listing_id,
            )
        elif _LOG_CUSTOM_URL_REQUEST.get():
            await log_custom_url_request(user_id, url, "success", listing_id=listing_id)
        logger.info(f"Custom-URL-Analyse abgeschlossen: {safe_url} -> {listing_id}")
        return AnalyzeUrlResponse(ok=True, listing_id=listing_id)
    except AnthropicRateLimitError as e:
        logger.warning(f"Custom-URL-Analyse: Anfragelimit erreicht ({safe_url}): {e}")
        return await _fail_job_or_log(
            job_id,
            user_id,
            url,
            "RATE_LIMITED: Anfragelimit für KI-Analysen erreicht",
            "Anfragelimit für KI-Analysen erreicht. Bitte in einigen Minuten erneut versuchen.",
            step=current_step if job_id else "failed",
            error_code="RATE_LIMITED",
        )
    except Exception as e:
        logger.error(f"Custom-URL-Analyse fehlgeschlagen ({safe_url}): {e}")
        return await _fail_job_or_log(
            job_id,
            user_id,
            url,
            f"Analyse fehlgeschlagen: {e}",
            "Bei der Analyse ist ein unerwarteter Fehler aufgetreten.",
            step=current_step if job_id else "failed",
        )


async def _run_analyse_job_bg(
    job_id: str,
    url: str,
    user_id: Optional[str],
    *,
    manual_html: Optional[str] = None,
    manual_pdf_base64: Optional[str] = None,
    cookie_header: Optional[str] = None,
    expected_listing_id: Optional[str] = None,
) -> None:
    try:
        await run_custom_url_analysis(
            url,
            user_id=user_id,
            job_id=job_id,
            manual_html=manual_html,
            manual_pdf_base64=manual_pdf_base64,
            cookie_header=cookie_header,
            expected_listing_id=expected_listing_id,
        )
    except HTTPException as e:
        detail = e.detail if isinstance(e.detail, str) else "Ungültige Anfrage"
        await _fail_job_or_log(
            job_id,
            user_id,
            url,
            detail,
            public_job_error_message(detail),
            step="failed",
        )
    except Exception as e:
        logger.exception(f"Async-Analyse-Job abgestürzt ({job_id}): {e}")
        capture_exception(e, path="/internal/analyze-url-async", extra={"job_id": job_id})
        await _fail_job_or_log(
            job_id,
            user_id,
            url,
            f"Job abgestürzt: {e}",
            "Bei der Analyse ist ein unerwarteter Fehler aufgetreten.",
            step="failed",
        )


def _memory_claim_system() -> bool:
    global _system_analyse_inflight
    if _system_analyse_inflight >= MAX_CONCURRENT_SYSTEM_ANALYSES:
        return False
    _system_analyse_inflight += 1
    return True


def _memory_claim_sync() -> bool:
    global _sync_analyse_inflight
    if _sync_analyse_inflight >= MAX_CONCURRENT_SYNC_ANALYSES:
        return False
    _sync_analyse_inflight += 1
    return True


def _memory_release_sync() -> None:
    global _sync_analyse_inflight
    _sync_analyse_inflight = max(0, _sync_analyse_inflight - 1)


def _memory_release_system() -> None:
    global _system_analyse_inflight
    _system_analyse_inflight = max(0, _system_analyse_inflight - 1)


async def _claim_systemanalyse_slot() -> bool:
    async with _system_analyse_lock:
        return try_claim_shared_slot(
            "system",
            MAX_CONCURRENT_SYSTEM_ANALYSES,
            memory_claim=_memory_claim_system,
        )


async def _claim_syncanalyse_slot() -> bool:
    async with _sync_analyse_lock:
        return try_claim_shared_slot(
            "sync",
            MAX_CONCURRENT_SYNC_ANALYSES,
            memory_claim=_memory_claim_sync,
        )


async def _release_syncanalyse_slot() -> None:
    async with _sync_analyse_lock:
        release_shared_slot("sync", memory_release=_memory_release_sync)


async def _release_systemanalyse_slot() -> None:
    async with _system_analyse_lock:
        release_shared_slot("system", memory_release=_memory_release_system)


async def _run_systemanalyse_bg(url: str) -> None:
    try:
        await run_custom_url_analysis(url, user_id=None)
    except Exception as e:
        logger.exception(f"Systemanalyse abgestürzt ({log_safe_url(url)}): {e}")
        capture_exception(e, path="/internal/analyze-url-async", extra={"url": url})
    finally:
        await _release_systemanalyse_slot()


def _validate_analyze_request(payload: AnalyzeUrlRequest) -> str:
    """Validiert die Content-Quellen-Kombination (Live-URL XOR HTML XOR PDF)
    und liefert die für Job-Anlage/Historie zu verwendende URL - die echte
    Live-URL, oder bei HTML-/PDF-Einreichung eine (optionale) Referenz-URL
    bzw. eine deterministisch aus dem Inhalt abgeleitete synthetische URL
    (siehe build_manual_reference_url)."""
    _reject_client_user_id(payload.user_id)
    payload.user_id = None
    has_html = bool(payload.html and payload.html.strip())
    has_pdf = bool(payload.pdf_base64 and payload.pdf_base64.strip())
    if has_html and has_pdf:
        raise HTTPException(
            422, "Bitte nur einen Inhalt einreichen (HTML-Einfügung ODER PDF-Upload)"
        )
    if payload.cookie_header and payload.cookie_header.strip() and (has_html or has_pdf):
        raise HTTPException(422, "Der Sitzungs-Cookie ist nur beim Live-Abruf per URL nutzbar")

    if has_html:
        if len(payload.html) > MAX_MANUAL_HTML_CHARS:
            raise HTTPException(
                422, f"HTML-Inhalt ist zu groß (Limit {MAX_MANUAL_HTML_CHARS:,} Zeichen)"
            )
        return _require_reference_url(payload.url) or build_manual_reference_url(
            "html", payload.html
        )

    if has_pdf:
        try:
            decode_pdf_base64(payload.pdf_base64)
        except ManualContentError as e:
            raise HTTPException(
                422, public_job_error_message(str(e)) or "PDF-Datei ist ungültig"
            ) from e
        return _require_reference_url(payload.url) or build_manual_reference_url(
            "pdf", payload.pdf_base64
        )

    if not payload.url:
        raise HTTPException(422, "URL fehlt")
    url = _normalize_source_url(payload.url)
    try:
        return assert_analyse_listing_url(url)
    except UrlSafetyError as e:
        raise HTTPException(422, public_url_safety_message(e)) from e


@app.post("/internal/analyze-url", response_model=AnalyzeUrlResponse)
async def analyze_url(
    payload: AnalyzeUrlRequest, authorization: Optional[str] = Header(None)
) -> AnalyzeUrlResponse:
    _check_auth(authorization)
    if os.environ.get("ALLOW_SYNC_ANALYSE", "false").lower() not in ("1", "true", "yes"):
        raise HTTPException(410, "Bitte /internal/analyze-url-async verwenden")
    source_url = _validate_analyze_request(payload)
    job_id, user_id, expected_listing_id = await _bind_analyse_actor_limited(payload)
    if not await _claim_syncanalyse_slot():
        if job_id:
            await _fail_job_or_log(
                job_id,
                user_id,
                "",
                "Maximal zwei synchrone Analysen gleichzeitig.",
                "Zu viele Analyse-Anfragen. Bitte kurz warten.",
                step="failed",
            )
        raise HTTPException(
            429,
            f"Maximal {MAX_CONCURRENT_SYNC_ANALYSES} synchrone Analysen gleichzeitig.",
        )
    try:
        result = await run_custom_url_analysis(
            source_url,
            user_id,
            job_id=job_id,
            manual_html=payload.html,
            manual_pdf_base64=payload.pdf_base64,
            cookie_header=payload.cookie_header,
            expected_listing_id=expected_listing_id,
        )
    finally:
        await _release_syncanalyse_slot()
    if not result.ok and result.error_code == "RATE_LIMITED":
        raise HTTPException(429, result.error or "Anfragelimit für KI-Analysen erreicht.")
    return result


@app.post("/internal/analyze-url-async", response_model=AnalyzeUrlAsyncResponse)
async def analyze_url_async(
    payload: AnalyzeUrlRequest,
    authorization: Optional[str] = Header(None),
) -> AnalyzeUrlAsyncResponse:
    _check_auth(authorization)

    url = _validate_analyze_request(payload)
    job_id, user_id, expected_listing_id = await _bind_analyse_actor_limited(payload)

    # Systemläufe (Kandidaten-Beförderung aus market_comparables) haben keinen
    # Nutzer und dürfen deshalb weder einen Job in dessen Liste legen noch gegen
    # dessen Parallelitätslimit zählen. Sie laufen trotzdem asynchron, damit der
    # Cron-Aufruf nicht minutenlang offen bleibt.
    if not user_id:
        if not await _claim_systemanalyse_slot():
            raise HTTPException(
                429,
                f"Maximal {MAX_CONCURRENT_SYSTEM_ANALYSES} Systemanalysen gleichzeitig.",
            )
        asyncio.create_task(_run_systemanalyse_bg(url))
        return AnalyzeUrlAsyncResponse(ok=True)

    asyncio.create_task(
        _run_analyse_job_bg(
            job_id,
            url,
            user_id,
            manual_html=payload.html,
            manual_pdf_base64=payload.pdf_base64,
            cookie_header=payload.cookie_header,
            expected_listing_id=expected_listing_id,
        )
    )
    return AnalyzeUrlAsyncResponse(ok=True, job_id=job_id)


class AnalyzeZvgListingRequest(BaseModel):
    listing_id: str
    requested_by: Optional[str] = None


class AnalyzeZvgListingResponse(BaseModel):
    ok: bool
    status: str
    analysis_tier: Optional[str] = None
    full_status: Optional[str] = None
    error: Optional[str] = None


@app.post("/internal/analyze-zvg-listing", response_model=AnalyzeZvgListingResponse)
async def analyze_zvg_listing(
    payload: AnalyzeZvgListingRequest,
    authorization: Optional[str] = Header(None),
) -> AnalyzeZvgListingResponse:
    _check_auth(authorization)
    from src.storage.postgres import (
        count_full_requests_today,
        get_ki_analysis_status,
        get_listing_for_quality_check,
        try_claim_full_analysis,
    )
    from src.utils.ki_tiers import ACTIVE_FULL_STATUSES, FULL_ANALYSIS_DAILY_LIMIT

    listing = await get_listing_for_quality_check(payload.listing_id)
    if not listing:
        raise HTTPException(404, "Listing nicht gefunden")

    current = await get_ki_analysis_status(payload.listing_id)
    if current and current.get("analysis_tier") == "full":
        return AnalyzeZvgListingResponse(
            ok=True,
            status="already_full",
            analysis_tier="full",
            full_status=current.get("full_status") or "idle",
        )
    if current and current.get("full_status") in ACTIVE_FULL_STATUSES:
        return AnalyzeZvgListingResponse(
            ok=True,
            status="in_progress",
            analysis_tier=current.get("analysis_tier"),
            full_status=current.get("full_status"),
        )

    if payload.requested_by:
        used = await count_full_requests_today(payload.requested_by)
        if used >= FULL_ANALYSIS_DAILY_LIMIT:
            raise HTTPException(
                429,
                f"Tageslimit von {FULL_ANALYSIS_DAILY_LIMIT} ausführlichen Analysen erreicht.",
            )

    claim = await try_claim_full_analysis(payload.listing_id, payload.requested_by)
    if claim["outcome"] in ("already_full", "in_progress"):
        return AnalyzeZvgListingResponse(
            ok=True,
            status=claim["outcome"],
            analysis_tier=claim.get("analysis_tier"),
            full_status=claim.get("full_status"),
        )
    if claim["outcome"] != "claimed":
        return AnalyzeZvgListingResponse(
            ok=False,
            status="failed",
            analysis_tier=claim.get("analysis_tier"),
            full_status=claim.get("full_status"),
            error="Analyse konnte nicht gestartet werden",
        )

    asyncio.create_task(_run_zvg_full_analysis_bg(payload.listing_id))
    return AnalyzeZvgListingResponse(
        ok=True,
        status="started",
        analysis_tier=claim.get("analysis_tier") or "basic",
        full_status="queued",
    )


async def _run_zvg_full_analysis_bg(listing_id: str) -> None:
    try:
        await run_requested_full_analysis(listing_id)
    except Exception as exc:
        logger.error(f"ZVG-Vollanalyse fehlgeschlagen ({listing_id}): {exc}")


@app.get("/internal/health")
async def health() -> dict:
    return {"ok": True}


@app.get("/internal/metrics", response_class=PlainTextResponse)
async def metrics(authorization: Optional[str] = Header(None)) -> str:
    """Prometheus-Textformat (siehe infra/monitoring/prometheus.yml).

    Bewusst getrennt von /internal/health, das JSON für Menschen liefert und
    von Prometheus nicht geparst werden kann.
    """
    _check_auth(authorization)
    from src.storage.postgres import get_connection, release_connection

    lines = [
        "# HELP gavel_up Scraper-API erreichbar",
        "# TYPE gavel_up gauge",
        "gavel_up 1",
    ]

    db_up = 0
    job_counts: dict[str, int] = {}
    active_jobs = 0
    zvg_active = 0
    fetch_source_counts: dict[str, int] = {}

    try:
        conn = await get_connection()
        try:
            rows = await conn.fetch(
                """
                SELECT status, count(*) AS n
                FROM custom_url_requests
                WHERE requested_at > NOW() - INTERVAL '24 hours'
                GROUP BY status
                """
            )
            job_counts = {r["status"]: r["n"] for r in rows}
            active_jobs = await conn.fetchval(
                "SELECT count(*) FROM custom_url_requests WHERE status IN ('queued','running')"
            )
            zvg_active = await conn.fetchval("SELECT count(*) FROM zvg_listings WHERE ist_aktiv")
            # Messbarer Fetch-Erfolg (Phase 1 - siehe docs/CUSTOM_URL_ANALYSIS.md):
            # woher kam der zuletzt erfolgreich gescrapte Inhalt (http/
            # manual_html/manual_pdf)?
            source_rows = await conn.fetch(
                """
                SELECT COALESCE(raw_data->'scrape_metadata'->>'fetch_source', 'unknown') AS src,
                       count(*) AS n
                FROM real_estate_listings
                WHERE last_seen_at > NOW() - INTERVAL '24 hours'
                GROUP BY src
                """
            )
            fetch_source_counts = {r["src"]: r["n"] for r in source_rows}
            db_up = 1
        finally:
            await release_connection(conn)
    except Exception as e:
        logger.warning(f"Metrics-Abfrage fehlgeschlagen: {e}")

    lines += [
        "# HELP gavel_db_up Postgres-Verbindung aus dem Scraper",
        "# TYPE gavel_db_up gauge",
        f"gavel_db_up {db_up}",
        "# HELP gavel_analyse_jobs_24h Custom-URL-Jobs der letzten 24h je Status",
        "# TYPE gavel_analyse_jobs_24h gauge",
    ]
    for status in ("queued", "running", "success", "error"):
        lines.append(f'gavel_analyse_jobs_24h{{status="{status}"}} {job_counts.get(status, 0)}')

    lines += [
        "# HELP gavel_analyse_fetch_source_24h Custom-URL-Listings der letzten 24h je Fetch-Quelle",
        "# TYPE gavel_analyse_fetch_source_24h gauge",
    ]
    for source in ("http", "manual_html", "manual_pdf", "unknown"):
        lines.append(
            f'gavel_analyse_fetch_source_24h{{source="{source}"}} {fetch_source_counts.get(source, 0)}'
        )

    lines += [
        "# HELP gavel_analyse_jobs_active Aktuell laufende oder wartende Jobs",
        "# TYPE gavel_analyse_jobs_active gauge",
        f"gavel_analyse_jobs_active {active_jobs or 0}",
        "# HELP gavel_zvg_listings_active Aktive ZVG-Listings",
        "# TYPE gavel_zvg_listings_active gauge",
        f"gavel_zvg_listings_active {zvg_active or 0}",
    ]

    return "\n".join(lines) + "\n"
