from __future__ import annotations

import os
import time
from collections import defaultdict, deque
from threading import Lock
from typing import Callable, Optional

from loguru import logger

REDIS_BURST_PREFIX = "gavel:analyse-burst:"
REDIS_SLOT_PREFIX = "gavel:analyse-slot:"

_clients: dict[str, object] = {}
_clients_lock = Lock()


class BurstLimiter:
    def __init__(self, max_hits: int, window_sec: float) -> None:
        self.max_hits = max_hits
        self.window_sec = window_sec
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] >= self.window_sec:
                q.popleft()
            if len(q) >= self.max_hits:
                return False
            q.append(now)
            return True


def allow_shared_burst(
    key: str,
    max_hits: int,
    window_sec: float,
    *,
    fail_closed: bool = True,
    memory: Optional[BurstLimiter] = None,
    redis_factory: Optional[Callable] = None,
    environ: Optional[dict[str, str]] = None,
) -> bool:
    """Redis-geteilt, damit Restart und mehrere Worker dasselbe Fenster teilen."""
    env = os.environ if environ is None else environ
    redis_url = (env.get("REDIS_URL") or "").strip()
    if redis_url:
        try:
            client = redis_factory() if redis_factory else _redis_client(redis_url)
            redis_key = f"{REDIS_BURST_PREFIX}{key}"
            count = int(client.incr(redis_key))
            ttl = int(client.ttl(redis_key))
            if ttl < 0:
                client.expire(redis_key, max(1, int(window_sec)))
            return count <= max_hits
        except Exception:
            logger.warning("Analyse-Burst: Redis nicht erreichbar")
            if fail_closed:
                return False
    if memory is None:
        return not fail_closed
    return memory.allow(key)


def try_claim_shared_slot(
    key: str,
    max_slots: int,
    *,
    ttl_sec: int = 1800,
    fail_closed: bool = True,
    memory_claim: Optional[Callable[[], bool]] = None,
    redis_factory: Optional[Callable] = None,
    environ: Optional[dict[str, str]] = None,
) -> bool:
    env = os.environ if environ is None else environ
    redis_url = (env.get("REDIS_URL") or "").strip()
    if redis_url:
        try:
            client = redis_factory() if redis_factory else _redis_client(redis_url)
            redis_key = f"{REDIS_SLOT_PREFIX}{key}"
            count = int(client.incr(redis_key))
            ttl = int(client.ttl(redis_key))
            if ttl < 0:
                client.expire(redis_key, max(1, int(ttl_sec)))
            if count > max_slots:
                client.decr(redis_key)
                return False
            return True
        except Exception:
            logger.warning("Analyse-Slot: Redis nicht erreichbar")
            if fail_closed:
                return False
    if memory_claim is None:
        return not fail_closed
    return memory_claim()


def release_shared_slot(
    key: str,
    *,
    redis_factory: Optional[Callable] = None,
    environ: Optional[dict[str, str]] = None,
    memory_release: Optional[Callable[[], None]] = None,
) -> None:
    env = os.environ if environ is None else environ
    redis_url = (env.get("REDIS_URL") or "").strip()
    if redis_url:
        try:
            client = redis_factory() if redis_factory else _redis_client(redis_url)
            redis_key = f"{REDIS_SLOT_PREFIX}{key}"
            count = int(client.decr(redis_key))
            if count < 0:
                client.delete(redis_key)
            return
        except Exception:
            logger.warning("Analyse-Slot: Redis-Release fehlgeschlagen")
    if memory_release is not None:
        memory_release()


def _redis_client(url: str):
    import redis as redis_lib

    with _clients_lock:
        client = _clients.get(url)
        if client is None:
            client = redis_lib.from_url(url, decode_responses=True)
            _clients[url] = client
        return client
