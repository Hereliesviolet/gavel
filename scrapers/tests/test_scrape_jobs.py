from src.storage.scrape_jobs import scrape_job_counts, scrape_job_status


def test_success_uses_found_key():
    assert scrape_job_status({"total_stored": 12}) == "success"
    assert scrape_job_counts({"total_stored": 12}, "total_stored") == (12, 0, 0, 0)
    assert scrape_job_counts(
        {"total_stored": 12, "items_new": 3, "items_updated": 9},
        "total_stored",
    ) == (12, 3, 9, 0)
    assert scrape_job_counts(
        {"total_stored": 90, "failed": 20},
        "total_stored",
    ) == (90, 0, 0, 20)


def test_error_is_failed():
    result = {"error": "timeout", "stored": 0}
    assert scrape_job_status(result) == "error"
    assert scrape_job_counts(result, "stored") == (0, 0, 0, 1)


def test_missing_cron_secret_is_failed():
    result = {"skipped": True, "error": "CRON_SECRET fehlt", "reason": "CRON_SECRET fehlt"}
    assert scrape_job_status(result) == "error"
    assert scrape_job_status({"skipped": True, "reason": "analysis-run-active"}) == "success"


def test_step_succeeded_today_uses_berlin_day_and_success_only():
    from pathlib import Path

    src = (Path(__file__).resolve().parents[1] / "src/storage/scrape_jobs.py").read_text()
    assert "async def step_succeeded_today" in src
    assert "Europe/Berlin" in src
    assert "status = 'success'" in src
    assert "date_trunc('day'" in src


def test_scrape_jobs_are_pruned():
    from pathlib import Path

    src = (Path(__file__).resolve().parents[1] / "src/storage/scrape_jobs.py").read_text()
    assert "DELETE FROM scrape_jobs" in src
    assert "INTERVAL '90 days'" in src
    alerts = (Path(__file__).resolve().parents[1] / "src/flows/check_alerts.py").read_text()
    assert '"error": "CRON_SECRET fehlt"' in alerts
    zvg = (Path(__file__).resolve().parents[1] / "src/flows/zvg_daily.py").read_text()
    hanmark = (Path(__file__).resolve().parents[1] / "src/flows/hanmark_daily.py").read_text()
    assert '"failed": total_failed' in zvg
    assert '"failed": total_failed' in hanmark
    assert "SpeicherquoteUnterschritten" in zvg
    assert "SpeicherquoteUnterschritten" in hanmark
