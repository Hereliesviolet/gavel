from src.utils.sentry import parse_sentry_dsn, sanitize_sentry_extra


def test_parses_dsn():
    parsed = parse_sentry_dsn("https://abc123@o1.ingest.sentry.io/456")
    assert parsed == {
        "public_key": "abc123",
        "host": "o1.ingest.sentry.io",
        "project_id": "456",
        "store_url": "https://o1.ingest.sentry.io/api/456/store/",
    }


def test_missing_dsn_is_noop():
    assert parse_sentry_dsn(None) is None
    assert parse_sentry_dsn("") is None
    assert parse_sentry_dsn("kein-dsn") is None


def test_sanitize_sentry_extra_strips_urls():
    cleaned = sanitize_sentry_extra(
        {
            "url": "https://portal.example/expose/1?token=abc&keep=1",
            "job_id": "job-1",
            "note": "https://portal.example/x?session=secret",
        }
    )
    assert cleaned["url"] == "https://portal.example/expose/1?keep=1"
    assert cleaned["job_id"] == "job-1"
    assert cleaned["note"] == "https://portal.example/x"
