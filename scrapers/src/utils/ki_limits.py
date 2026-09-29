import os


def env_limit(name: str, default: int) -> int:
    raw = os.environ.get(name, str(default)).strip()
    try:
        return max(1, int(raw))
    except ValueError:
        return default


def ki_daily_limit() -> int:
    return env_limit("KI_DAILY_LIMIT", 500)


def ki_backup_limit() -> int:
    return env_limit("KI_BACKUP_LIMIT", 400)
