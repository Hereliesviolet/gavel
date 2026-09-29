from pathlib import Path

from src.utils.analysis_version import (
    BASIC_SCHEMA_VERSION,
    FULL_SCHEMA_VERSION,
    with_schema_version,
)
from src.utils.ki_tiers import interpret_full_claim, should_skip_basic_for_status


ROOT = Path(__file__).resolve().parents[1]


def test_schema_markers_depend_on_tier():
    assert with_schema_version("claude-haiku-4-5-default", tier="basic").endswith(
        f"+{BASIC_SCHEMA_VERSION}"
    )
    assert with_schema_version("haiku+sonnet", tier="full").endswith(f"+{FULL_SCHEMA_VERSION}")
    assert "investment-v2" in with_schema_version("claude-sonnet-4-6-default")


def test_basic_skips_full_and_in_progress_rows():
    assert should_skip_basic_for_status({"analysis_tier": "full", "full_status": "idle"})
    assert should_skip_basic_for_status({"analysis_tier": "basic", "full_status": "queued"})
    assert should_skip_basic_for_status({"analysis_tier": "basic", "full_status": "running"})
    assert not should_skip_basic_for_status({"analysis_tier": "basic", "full_status": "idle"})
    assert not should_skip_basic_for_status(None)


def test_second_full_claim_is_idempotent():
    assert interpret_full_claim({"listing_id": "1"}, None) == "claimed"
    assert (
        interpret_full_claim(None, {"analysis_tier": "full", "full_status": "idle"})
        == "already_full"
    )
    assert (
        interpret_full_claim(None, {"analysis_tier": "basic", "full_status": "queued"})
        == "in_progress"
    )
    assert (
        interpret_full_claim(None, {"analysis_tier": "basic", "full_status": "running"})
        == "in_progress"
    )


def test_reanalysis_condition_ignores_basic_rows():
    ki = (ROOT / "src/flows/ki_analysis.py").read_text()
    assert "k.analysis_tier IS DISTINCT FROM 'basic'" in ki
    assert "get_listings_needing_reanalysis" in ki


def test_upsert_refuses_to_downgrade_full():
    sql = (ROOT / "src/storage/postgres.py").read_text()
    assert "analysis_tier IS DISTINCT FROM 'full'" in sql
    assert "OR EXCLUDED.analysis_tier = 'full'" in sql
    assert "full_status IN ('queued', 'running')" in sql


def test_claim_sql_is_shared_and_single_flight():
    sql = (ROOT / "src/storage/postgres.py").read_text()
    assert "async def try_claim_full_analysis" in sql
    assert "NOT IN ('queued', 'running')" in sql
    assert "analysis_tier IS DISTINCT FROM 'full'" in sql


def test_analyze_listing_uses_haiku_extract_and_sonnet_invest():
    ki = (ROOT / "src/flows/ki_analysis.py").read_text()
    assert "langdock_extract_model" in ki
    assert "langdock_invest_model" in ki
    assert "KIBasicAnalyseResult" in ki
    assert "KIFactExtractResult" in ki
    assert "run_investment_enrichment" in ki
    assert "claude-haiku-4-5-default" in ki
    assert 'tier="full"' in ki
    assert "async def run_requested_full_analysis" in ki


def test_scraper_exposes_shared_full_endpoint():
    app = (ROOT / "src/api/app.py").read_text()
    assert "/internal/analyze-zvg-listing" in app
    assert "try_claim_full_analysis" in app
    assert "run_requested_full_analysis" in app
    assert "FULL_ANALYSIS_DAILY_LIMIT" in app
