import inspect

from src.storage.real_estate import (
    ACCEPTED_STALE_ANALYSE_JOB_MINUTES,
    ANALYSE_ERROR_RETENTION_DAYS,
    ANALYSE_HISTORY_KEEP_SUCCESS,
    STALE_ANALYSE_JOB_MINUTES,
    analyse_job_updatable_statuses,
    reap_stale_analyse_jobs,
    try_create_analyse_job,
    update_analyse_job,
)


def test_success_can_heal_false_reap():
    assert analyse_job_updatable_statuses("success") == ("queued", "running", "error")


def test_error_cannot_overwrite_terminal_states():
    assert analyse_job_updatable_statuses("error") == ("queued", "running")


def test_progress_does_not_quietly_heal_error():
    assert analyse_job_updatable_statuses("running") == ("queued", "running")
    assert analyse_job_updatable_statuses(None) == ("queued", "running")


def test_accepted_stale_window_is_wider_than_first_progress():
    assert ACCEPTED_STALE_ANALYSE_JOB_MINUTES == 15
    assert STALE_ANALYSE_JOB_MINUTES == 45
    assert ACCEPTED_STALE_ANALYSE_JOB_MINUTES < STALE_ANALYSE_JOB_MINUTES


def test_reaper_sql_does_not_kill_accepted_jobs_that_already_have_a_listing():
    source = inspect.getsource(reap_stale_analyse_jobs)
    assert "listing_id IS NULL" in source
    assert "step, 'queued') = 'accepted'" in source


def test_success_update_uses_healable_status_set():
    source = inspect.getsource(update_analyse_job)
    assert "analyse_job_updatable_statuses(status)" in source


def test_job_create_keeps_last_success_per_listing():
    source = inspect.getsource(try_create_analyse_job)
    assert ANALYSE_HISTORY_KEEP_SUCCESS == 200
    assert ANALYSE_ERROR_RETENTION_DAYS == 90
    assert "SELECT DISTINCT ON (listing_id) id" in source
    assert "keep_success" in source
    assert "status = 'error'" in source
