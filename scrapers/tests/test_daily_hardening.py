from pathlib import Path

import src.utils.ki_limits as ki_limits


ROOT = Path(__file__).resolve().parents[1]


def test_ki_limits_from_env(monkeypatch):
    monkeypatch.delenv("KI_DAILY_LIMIT", raising=False)
    monkeypatch.delenv("KI_BACKUP_LIMIT", raising=False)
    assert ki_limits.ki_daily_limit() == 500
    assert ki_limits.ki_backup_limit() == 400
    monkeypatch.setenv("KI_DAILY_LIMIT", "750")
    monkeypatch.setenv("KI_BACKUP_LIMIT", "0")
    assert ki_limits.ki_daily_limit() == 750
    assert ki_limits.ki_backup_limit() == 1
    monkeypatch.setenv("KI_DAILY_LIMIT", "x")
    assert ki_limits.ki_daily_limit() == 500


def test_deploy_does_not_overlap_portal_with_backups():
    deploy = (ROOT / "deploy_flows.py").read_text()
    assert 'cron="0 11 * * *"' in deploy
    assert 'cron="0 17 * * *"' in deploy
    assert 'cron="0 14 * * *"' in deploy
    assert 'cron="0 15 * * *"' in deploy
    assert 'cron="30 15 * * *"' in deploy
    assert 'cron="0 9 * * *"' not in deploy
    assert 'cron="30 8 * * *"' not in deploy
    assert '"occupy_worker": True' in deploy
    assert "ki_backup_limit()" in deploy
    assert "gavel-heavy-worker" in (ROOT / "src/utils/analysis_run_lock.py").read_text()


def test_ki_backup_waits_on_heavy_lock():
    ki = (ROOT / "src/flows/ki_analysis.py").read_text()
    assert "occupy_worker: bool = False" in ki
    assert "hold_heavy_run_lock" in ki
    assert "async def _run_ki_analysis" in ki


def test_daily_ki_runs_only_basic_and_skips_reanalysis_fill():
    ki = (ROOT / "src/flows/ki_analysis.py").read_text()
    run_fn = ki.split("async def _run_ki_analysis")[1].split("\nasync def ")[0]
    assert "get_listings_without_ki" in run_fn
    assert "get_listings_needing_reanalysis" not in run_fn
    assert 'tier="basic"' in run_fn
    assert "analyze_reanalysis_candidate" not in run_fn


def test_ki_selection_excludes_failed_ids():
    ki = (ROOT / "src/flows/ki_analysis.py").read_text()
    assert "l.id <> ALL(" in ki
    assert "failed_ids" in ki


def test_recreate_worker_script_checks_heavy_lock():
    script = (ROOT.parent / "scripts/recreate-prefect-worker.sh").read_text()
    assert "gavel-heavy-worker" in script
    assert "pg_try_advisory_lock" in script
    assert "exit 2" in script
    assert "prefect-worker" in script
