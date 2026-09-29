from src.utils.cron_secret import cron_secret_for_audience


def test_prefers_scoped_secret():
    assert (
        cron_secret_for_audience(
            "CRON_EMAIL_SECRET",
            environ={"CRON_SECRET": "shared", "CRON_EMAIL_SECRET": "mail-only"},
        )
        == "mail-only"
    )


def test_falls_back_to_shared_secret():
    assert (
        cron_secret_for_audience(
            "CRON_OPS_SECRET",
            environ={"CRON_SECRET": "shared"},
        )
        == "shared"
    )


def test_empty_when_nothing_configured():
    assert cron_secret_for_audience("CRON_JOBS_SECRET", environ={}) is None
    assert (
        cron_secret_for_audience(
            "CRON_JOBS_SECRET",
            environ={"CRON_SECRET": "  ", "CRON_JOBS_SECRET": ""},
        )
        is None
    )
