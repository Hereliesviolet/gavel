import json
from pathlib import Path
from uuid import uuid4

from src.storage.postgres import data_quality_previous_payload


def test_previous_stats_are_json_safe() -> None:
    assert data_quality_previous_payload(None) is None
    assert data_quality_previous_payload({"total_needs_review": "x"}) is None
    safe = data_quality_previous_payload(
        {"id": uuid4(), "total_needs_review": 4, "stat_date": object()}
    )
    assert safe == {"total_needs_review": 4}
    json.dumps({"previous": safe})

    src = (Path(__file__).resolve().parents[1] / "src/storage/postgres.py").read_text()
    fn = src.split("async def get_previous_data_quality_stats", 1)[1]
    assert "SELECT total_needs_review FROM data_quality_daily_stats" in fn
    assert "SELECT * FROM data_quality_daily_stats" not in fn
    flow = (Path(__file__).resolve().parents[1] / "src/flows/data_quality.py").read_text()
    assert '"previous": previous,' in flow
    assert "dict(previous)" not in flow
