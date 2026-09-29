import pytest


@pytest.fixture(autouse=True)
def _no_robots_lookups_by_default(monkeypatch):
    """Unit tests must not fetch robots.txt; test_robots.py switches the check back on."""
    monkeypatch.setenv("RESPECT_ROBOTS_TXT", "false")
