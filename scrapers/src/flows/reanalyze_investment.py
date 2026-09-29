"""
Prefect-Flow: Massen-Re-Analyse zur Investment-Anreicherung (Backfill).

Bewertet bestehende Objekte, deren KI-Analyse VOR Einführung der
Investment-/Fix&Flip-Felder erstellt wurde, mit der KANONISCHEN Pipeline:

  - ZVG ohne Analyse: vollständiges analyze_listing().
  - Bestehende ZVG-Analysen: gemeinsamer Investment-Prompt auf den bereits
    strukturierten Gutachtendaten; vorhandene Extraktionsfelder bleiben
    unverändert. Reine Deal-Lücken nutzen nur den bestehenden ARV-Call.
    Vollständige Ergebnisse erhalten nach strenger Feld-/Zeitprüfung nur den
    Schema-Marker.
  - Custom-URL (real_estate_listings): run_custom_url_analysis() aus
    src/api/app.py (erneuter Fetch + Extraktion + Markt-/
    Investment-Analyse + Fix&Flip-Deal). Dieselbe Logik wie der
    HTTP-Endpoint /internal/analyze-url (DRY).

Der Versions-Marker (src/utils/analysis_version.py) wird beim Speichern
automatisch an model_used angehängt, sodass re-analysierte Objekte sofort als
aktuell markiert sind und beim nächsten Lauf nicht erneut anfallen (außer bei
--full-reanalyze).

CLI (im Scraper-Container):
    python -m src.flows.reanalyze_investment --dry-run --full-reanalyze
    python -m src.flows.reanalyze_investment --limit 15 --full-reanalyze
    python -m src.flows.reanalyze_investment --include-custom-url --limit 10
    python -m src.flows.reanalyze_investment --custom-url-only

Parameter:
  --limit N            Max. Anzahl Objekte (default: unbegrenzt, Batching à --batch-size)
  --dry-run            Nur Kandidaten zählen + auflisten, keine LLM-Calls
  --full-reanalyze     ALLE aktiven bewertbaren Listings (ignoriert den Marker)
  --source FILTER      Nur ZVG-Quelle (zvg.com/hanmark.de/justizportal)
  --include-custom-url Zusätzlich Custom-URL-Listings re-analysieren
  --skip-custom-url    Custom-URL überspringen (Default: erster Lauf nur ZVG)
  --custom-url-only    NUR Custom-URL-Listings (kein ZVG)
  --batch-size N       Batch-Größe bei unbegrenztem Lauf (default: 50)
  --concurrency N      Parallele ZVG-Objekte, 1 bis 3 (default: 3)
"""

import argparse
import asyncio
from collections import Counter
from typing import Optional

from prefect import flow, get_run_logger

from src.api.app import MAX_CONCURRENT_SYSTEM_ANALYSES, run_custom_url_analysis
from src.flows.ki_analysis import analyze_reanalysis_candidate, get_zvg_reanalysis_candidates
from src.storage.real_estate import custom_listing_exists, get_custom_url_listings_for_reanalysis
from src.utils.analysis_run_lock import try_analysis_run_lock
from src.utils.burst_limit import release_shared_slot, try_claim_shared_slot

RATE_LIMIT_SLEEP = 2  # Sekunden zwischen LLM-Calls, wie im ki_analysis_flow
SYSTEM_SLOT_RETRIES = 36
SYSTEM_SLOT_SLEEP = 5


async def claim_system_analyse_slot(max_slots: int = MAX_CONCURRENT_SYSTEM_ANALYSES) -> bool:
    return try_claim_shared_slot("system", max_slots)


def release_system_analyse_slot() -> None:
    release_shared_slot("system")


async def run_custom_url_reanalysis(
    url: str,
    user_id: Optional[str],
    log,
    expected_listing_id: str,
) -> object:
    claimed = False
    for _ in range(SYSTEM_SLOT_RETRIES):
        if await claim_system_analyse_slot():
            claimed = True
            break
        log.warning("System-Analyse-Slot belegt, warte auf freien Slot")
        await asyncio.sleep(SYSTEM_SLOT_SLEEP)
    if not claimed:
        raise RuntimeError("Kein System-Analyse-Slot frei")
    try:
        return await run_custom_url_analysis(
            url,
            str(user_id) if user_id else None,
            log_request=False,
            expected_listing_id=expected_listing_id,
        )
    finally:
        release_system_analyse_slot()


async def _reanalyze_zvg(
    log,
    limit: Optional[int],
    source_filter: Optional[str],
    full_reanalyze: bool,
    dry_run: bool,
    batch_size: int,
    concurrency: int,
) -> dict:
    fetch_limit = limit if limit is not None else 10**9
    candidates = await get_zvg_reanalysis_candidates(
        limit=fetch_limit, source_filter=source_filter, full_reanalyze=full_reanalyze
    )

    mode_counts = Counter(c.get("reanalysis_mode", "full") for c in candidates)
    log.info(f"ZVG-Kandidaten nach Pfad: {dict(mode_counts)}")

    if dry_run:
        log.info(
            f"[DRY-RUN] ZVG-Kandidaten: {len(candidates)} "
            f"(full_reanalyze={full_reanalyze}, source={source_filter or 'alle'})"
        )
        for i, c in enumerate(candidates[:300], 1):
            log.info(
                f"  [{i}/{len(candidates)}] {c['aktenzeichen']} "
                f"[{c['source']}, {c.get('reanalysis_mode', 'full')}]"
            )
        if len(candidates) > 300:
            log.info(f"  ... ({len(candidates) - 300} weitere)")
        return {
            "candidates": len(candidates),
            "modes": dict(mode_counts),
            "success": 0,
            "fail": 0,
            "dry_run": True,
        }

    success = fail = processed = 0
    semaphore = asyncio.Semaphore(concurrency)

    async def run_one(index: int, listing: dict) -> bool:
        async with semaphore:
            az = listing.get("aktenzeichen")
            try:
                ok = await analyze_reanalysis_candidate(listing)
            except Exception as exc:
                ok = False
                log.error(f"[{index}] {az} [{listing.get('source')}] EXCEPTION: {exc}")
            if listing.get("reanalysis_mode") != "marker":
                await asyncio.sleep(RATE_LIMIT_SLEEP)
            if ok:
                log.info(
                    f"[{index}] {az} [{listing.get('source')}, "
                    f"{listing.get('reanalysis_mode', 'full')}] success"
                )
            else:
                log.warning(
                    f"[{index}] {az} [{listing.get('source')}, "
                    f"{listing.get('reanalysis_mode', 'full')}] fail"
                )
            return ok

    for batch_start in range(0, len(candidates), batch_size):
        batch = candidates[batch_start : batch_start + batch_size]
        results = await asyncio.gather(
            *(run_one(batch_start + index, listing) for index, listing in enumerate(batch, 1))
        )
        processed += len(results)
        success += sum(results)
        fail += len(results) - sum(results)

    log.info(f"ZVG-Re-Analyse abgeschlossen: {success} ok, {fail} fehlgeschlagen (von {processed})")
    return {
        "candidates": processed,
        "modes": dict(mode_counts),
        "success": success,
        "fail": fail,
        "dry_run": False,
    }


async def _reanalyze_custom_url(
    log,
    limit: Optional[int],
    dry_run: bool,
    batch_size: int,
) -> dict:
    fetch_limit = limit if limit is not None else 10**9
    candidates = await get_custom_url_listings_for_reanalysis(limit=fetch_limit)

    if dry_run:
        log.info(f"[DRY-RUN] Custom-URL-Kandidaten: {len(candidates)}")
        for i, c in enumerate(candidates[:300], 1):
            log.info(f"  [{i}/{len(candidates)}] {c['source_url']}")
        return {"candidates": len(candidates), "success": 0, "fail": 0, "dry_run": True}

    success = fail = processed = 0
    for batch_start in range(0, len(candidates), batch_size):
        batch = candidates[batch_start : batch_start + batch_size]
        for row in batch:
            processed += 1
            url = row["source_url"]
            user_id = row.get("submitted_by_user_id")
            listing_id = str(row["id"]) if row.get("id") else ""
            if not listing_id or not await custom_listing_exists(listing_id):
                log.info(f"[{processed}] {url} übersprungen: Listing gelöscht")
                continue
            try:
                res = await run_custom_url_reanalysis(url, user_id, log, listing_id)
                ok = bool(res.ok)
                if not ok:
                    log.warning(f"[{processed}] {url} fail: {res.error}")
            except Exception as e:
                ok = False
                log.error(f"[{processed}] {url} EXCEPTION: {e}")
            if ok:
                success += 1
                log.info(f"[{processed}] {url} success -> {res.listing_id}")
            else:
                fail += 1
            await asyncio.sleep(RATE_LIMIT_SLEEP)

    log.info(
        f"Custom-URL-Re-Analyse abgeschlossen: {success} ok, {fail} fehlgeschlagen (von {processed})"
    )
    return {"candidates": processed, "success": success, "fail": fail, "dry_run": False}


@flow(
    name="reanalyze-investment-enrichment",
    description=(
        "Massen-Re-Analyse: reichert bestehende ZVG- und Custom-URL-Analysen "
        "mit Investment-Score/Fix&Flip-Deal über die kanonische Pipeline an"
    ),
    log_prints=True,
)
async def reanalyze_investment_flow(
    limit: Optional[int] = None,
    source_filter: Optional[str] = None,
    full_reanalyze: bool = False,
    dry_run: bool = False,
    include_custom_url: bool = False,
    custom_url_only: bool = False,
    batch_size: int = 50,
    concurrency: int = 3,
) -> dict:
    log = get_run_logger()
    if batch_size <= 0:
        raise ValueError("batch_size muss größer als 0 sein")
    if concurrency < 1 or concurrency > 3:
        raise ValueError("concurrency muss zwischen 1 und 3 liegen")

    async with try_analysis_run_lock() as lock_acquired:
        if not lock_acquired:
            log.warning("Re-Analyse übersprungen: Ein anderer KI-Analyse-Lauf ist bereits aktiv")
            return {"skipped": True, "reason": "analysis-run-active"}

        do_zvg = not custom_url_only
        do_custom = include_custom_url or custom_url_only

        result: dict = {}
        if do_zvg:
            log.info(
                f"=== ZVG-Re-Analyse (limit={limit}, source={source_filter or 'alle'}, "
                f"full_reanalyze={full_reanalyze}, dry_run={dry_run}) ==="
            )
            result["zvg"] = await _reanalyze_zvg(
                log, limit, source_filter, full_reanalyze, dry_run, batch_size, concurrency
            )
        if do_custom:
            log.info(f"=== Custom-URL-Re-Analyse (limit={limit}, dry_run={dry_run}) ===")
            result["custom_url"] = await _reanalyze_custom_url(log, limit, dry_run, batch_size)

        log.info(f"Re-Analyse-Zusammenfassung: {result}")
        return result


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Investment-Re-Analyse (Backfill)")
    p.add_argument(
        "--limit", type=int, default=None, help="Max. Anzahl Objekte (default: unbegrenzt)"
    )
    p.add_argument("--dry-run", action="store_true", help="Nur zählen/auflisten, keine LLM-Calls")
    p.add_argument(
        "--full-reanalyze", action="store_true", help="ALLE aktiven Listings (ignoriert Marker)"
    )
    p.add_argument(
        "--source", type=str, default=None, help="ZVG-Quelle: zvg.com/hanmark.de/justizportal"
    )
    p.add_argument(
        "--include-custom-url", action="store_true", help="Zusätzlich Custom-URL re-analysieren"
    )
    p.add_argument(
        "--skip-custom-url", action="store_true", help="Custom-URL überspringen (Default)"
    )
    p.add_argument("--custom-url-only", action="store_true", help="NUR Custom-URL (kein ZVG)")
    p.add_argument("--batch-size", type=int, default=50, help="Batch-Größe bei unbegrenztem Lauf")
    p.add_argument("--concurrency", type=int, choices=(1, 2, 3), default=3)
    return p.parse_args()


def main() -> None:
    args = _parse_args()
    include_custom = args.include_custom_url and not args.skip_custom_url
    asyncio.run(
        reanalyze_investment_flow(
            limit=args.limit,
            source_filter=args.source,
            full_reanalyze=args.full_reanalyze,
            dry_run=args.dry_run,
            include_custom_url=include_custom,
            custom_url_only=args.custom_url_only,
            batch_size=args.batch_size,
            concurrency=args.concurrency,
        )
    )


if __name__ == "__main__":
    main()
