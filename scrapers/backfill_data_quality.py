#!/usr/bin/env python3
"""
Vollaudit-Script: Wendet die Plausibilitäts-Engine (src/utils/data_quality.py)
einmalig auf ALLE aktuell aktiven ZVG-Listings an und gibt eine Übersicht nach
Quelle + Problemtyp aus. Schreibt die Flags dabei genauso in die DB wie der
tägliche Prefect-Task (run_quality_checks_task) - dieses Script ist im
Wesentlichen dessen manuell ausführbares Äquivalent für den initialen
Vollaudit bzw. spätere Ad-hoc-Neuprüfungen nach Regeländerungen.

Verwendung:
    cd scrapers
    .venv/bin/python backfill_data_quality.py [--dry-run] [--sample N]

--dry-run: Flags werden berechnet + ausgegeben, aber NICHT in die DB geschrieben.
--sample N: Gibt zusätzlich N konkrete Beispiel-Listings pro Problemtyp aus
            (aktenzeichen, source, betroffener Wert) für die manuelle
            Stichprobenprüfung gegen die Originalquelle.
"""

import asyncio
import argparse
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import asyncpg
from loguru import logger

from src.utils.data_quality import evaluate_listing, needs_review, flags_to_json

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://immopulse:change-me@localhost:5432/immopulse",
)


async def run_audit(dry_run: bool = False, sample: int = 0) -> None:
    db_url = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")
    conn = await asyncpg.connect(db_url)

    try:
        rows = await conn.fetch(
            """
            SELECT l.*, to_jsonb(k) AS ki_analyse
            FROM zvg_listings l
            LEFT JOIN zvg_ki_analyses k ON k.listing_id = l.id
            WHERE l.ist_aktiv = TRUE
            ORDER BY l.source, l.aktenzeichen
            """
        )
        logger.info(f"Vollaudit: {len(rows)} aktive Listings werden geprüft...")

        import json as _json

        total_flagged = 0
        by_source_total: Counter = Counter()
        by_source_flagged: Counter = Counter()
        by_reason: Counter = Counter()
        by_source_reason: Counter = Counter()
        examples: dict[str, list[tuple]] = defaultdict(list)

        for row in rows:
            listing = dict(row)
            raw_ki = listing.get("ki_analyse")
            ki_row = {}
            if raw_ki:
                try:
                    parsed = raw_ki if isinstance(raw_ki, dict) else _json.loads(raw_ki)
                    ki_row = parsed if isinstance(parsed, dict) else {}
                except (TypeError, ValueError):
                    ki_row = {}

            source = listing.get("source", "?")
            by_source_total[source] += 1

            flags = evaluate_listing(listing, ki=ki_row)
            review = needs_review(flags)

            if review:
                total_flagged += 1
                by_source_flagged[source] += 1

            for f in flags:
                key = f"{f.field}:{f.reason}"
                by_reason[key] += 1
                by_source_reason[f"{source}|{key}"] += 1
                if len(examples[key]) < sample:
                    examples[key].append((listing.get("aktenzeichen"), source, f.value, f.message))

            if not dry_run:
                await conn.execute(
                    """
                    UPDATE zvg_listings
                    SET data_quality_flags = $1::jsonb, needs_review = $2, data_quality_checked_at = NOW()
                    WHERE id = $3
                    """,
                    _json.dumps(flags_to_json(flags)),
                    review,
                    listing["id"],
                )

        # ─── Bericht ───────────────────────────────────────────────
        print("\n" + "=" * 78)
        print("VOLLAUDIT-ERGEBNIS (alle aktiven Listings)")
        print("=" * 78)
        print(f"Gesamt aktiv geprüft: {len(rows)}")
        print(f"Davon needs_review:   {total_flagged} ({total_flagged / len(rows) * 100:.1f}%)")
        print()
        print("Nach Quelle:")
        for source in sorted(by_source_total):
            n_total = by_source_total[source]
            n_flag = by_source_flagged[source]
            print(
                f"  {source:15s}: {n_flag:4d} / {n_total:4d} ({n_flag / n_total * 100:5.1f}%) needs_review"
            )
        print()
        print("Top-Problemtypen (Feld:Grund → Anzahl):")
        for key, count in by_reason.most_common(25):
            print(f"  {key:55s} {count:4d}")
        print()
        if sample:
            print("Stichproben pro Problemtyp:")
            for key, ex_list in examples.items():
                print(f"\n  --- {key} ---")
                for az, source, value, message in ex_list:
                    print(f"    [{source}] {az}: {value!r}")
                    print(f"      → {message}")
        print("=" * 78)
        if dry_run:
            print("(dry-run: keine Änderungen in der DB gespeichert)")

    finally:
        await conn.close()


def main():
    parser = argparse.ArgumentParser(
        description="Vollaudit: Plausibilitätsprüfung aller aktiven ZVG-Listings."
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Nur berechnen/ausgeben, nicht in DB schreiben"
    )
    parser.add_argument(
        "--sample", type=int, default=0, help="N Beispiel-Listings pro Problemtyp ausgeben"
    )
    args = parser.parse_args()

    asyncio.run(run_audit(dry_run=args.dry_run, sample=args.sample))


if __name__ == "__main__":
    main()
