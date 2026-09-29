ACTIVE_FULL_STATUSES = ("queued", "running")
FULL_ANALYSIS_DAILY_LIMIT = 10


def interpret_full_claim(returning_row: dict | None, current_row: dict | None) -> str:
    if returning_row:
        return "claimed"
    if current_row and current_row.get("analysis_tier") == "full":
        return "already_full"
    if current_row and current_row.get("full_status") in ACTIVE_FULL_STATUSES:
        return "in_progress"
    return "failed"


def should_skip_basic_for_status(status: dict | None) -> bool:
    if not status:
        return False
    if status.get("analysis_tier") == "full":
        return True
    return status.get("full_status") in ACTIVE_FULL_STATUSES
