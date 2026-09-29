from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from src.utils.data_quality import check_termin, termin_ist_abgelaufen

_BERLIN = ZoneInfo("Europe/Berlin")


def test_date_only_termin_stays_upcoming_on_berlin_calendar_day():
    termin = datetime(2026, 9, 13, 0, 0, tzinfo=_BERLIN)
    now = datetime(2026, 9, 13, 16, 30, tzinfo=_BERLIN)
    assert termin.astimezone(timezone.utc) < now.astimezone(timezone.utc)
    assert termin_ist_abgelaufen(termin, now) is False
    flags = check_termin({"termin_date": termin, "ist_aktiv": True}, now=now)
    assert not any(f.reason == "past_but_active" for f in flags)


def test_date_only_termin_is_past_after_berlin_calendar_day():
    termin = datetime(2026, 9, 13, 0, 0, tzinfo=_BERLIN)
    now = datetime(2026, 9, 14, 0, 1, tzinfo=_BERLIN)
    assert termin_ist_abgelaufen(termin, now) is True
    flags = check_termin({"termin_date": termin, "ist_aktiv": True}, now=now)
    assert any(f.reason == "past_but_active" for f in flags)


def test_timed_termin_is_past_immediately():
    termin = datetime(2026, 9, 13, 10, 0, tzinfo=_BERLIN)
    now = datetime(2026, 9, 13, 10, 1, tzinfo=_BERLIN)
    assert termin_ist_abgelaufen(termin, now) is True
    later = datetime(2026, 9, 13, 9, 59, tzinfo=_BERLIN)
    assert termin_ist_abgelaufen(termin, later) is False
    flags = check_termin({"termin_date": termin, "ist_aktiv": True}, now=now)
    assert any(f.reason == "past_but_active" for f in flags)
