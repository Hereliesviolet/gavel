from src.utils.burst_limit import (
    BurstLimiter,
    allow_shared_burst,
    release_shared_slot,
    try_claim_shared_slot,
)


class FakeRedis:
    def __init__(self, *, fail: bool = False) -> None:
        self.store: dict[str, int] = {}
        self.ttls: dict[str, int] = {}
        self.fail = fail

    def incr(self, key: str) -> int:
        if self.fail:
            raise ConnectionError("down")
        self.store[key] = self.store.get(key, 0) + 1
        return self.store[key]

    def decr(self, key: str) -> int:
        if self.fail:
            raise ConnectionError("down")
        self.store[key] = self.store.get(key, 0) - 1
        return self.store[key]

    def delete(self, key: str) -> None:
        if self.fail:
            raise ConnectionError("down")
        self.store.pop(key, None)
        self.ttls.pop(key, None)

    def expire(self, key: str, seconds: int) -> None:
        if self.fail:
            raise ConnectionError("down")
        self.ttls[key] = seconds

    def ttl(self, key: str) -> int:
        if self.fail:
            raise ConnectionError("down")
        return self.ttls.get(key, -1)


def test_burst_limiter_allows_then_blocks():
    limiter = BurstLimiter(2, 60)
    assert limiter.allow("u1") is True
    assert limiter.allow("u1") is True
    assert limiter.allow("u1") is False
    assert limiter.allow("u2") is True


def test_shared_burst_uses_memory_without_redis():
    limiter = BurstLimiter(1, 60)
    assert allow_shared_burst("u1", 1, 60, environ={}, memory=limiter) is True
    assert allow_shared_burst("u1", 1, 60, environ={}, memory=limiter) is False


def test_shared_burst_shares_window_across_callers():
    redis = FakeRedis()
    assert (
        allow_shared_burst(
            "u1",
            2,
            60,
            environ={"REDIS_URL": "redis://test"},
            redis_factory=lambda: redis,
        )
        is True
    )
    assert (
        allow_shared_burst(
            "u1",
            2,
            60,
            environ={"REDIS_URL": "redis://test"},
            redis_factory=lambda: redis,
        )
        is True
    )
    assert (
        allow_shared_burst(
            "u1",
            2,
            60,
            environ={"REDIS_URL": "redis://test"},
            redis_factory=lambda: redis,
        )
        is False
    )
    assert redis.ttls["gavel:analyse-burst:u1"] == 60


def test_shared_burst_fail_closed_when_redis_down():
    assert (
        allow_shared_burst(
            "u1",
            5,
            60,
            fail_closed=True,
            environ={"REDIS_URL": "redis://test"},
            redis_factory=lambda: FakeRedis(fail=True),
        )
        is False
    )


def test_shared_burst_memory_fallback_when_fail_open():
    limiter = BurstLimiter(1, 60)
    assert (
        allow_shared_burst(
            "u1",
            1,
            60,
            fail_closed=False,
            memory=limiter,
            environ={"REDIS_URL": "redis://test"},
            redis_factory=lambda: FakeRedis(fail=True),
        )
        is True
    )
    assert limiter.allow("u1") is False


def test_shared_slot_caps_and_releases():
    redis = FakeRedis()
    env = {"REDIS_URL": "redis://test"}

    def factory():
        return redis

    assert try_claim_shared_slot("sync", 2, environ=env, redis_factory=factory) is True
    assert try_claim_shared_slot("sync", 2, environ=env, redis_factory=factory) is True
    assert try_claim_shared_slot("sync", 2, environ=env, redis_factory=factory) is False
    release_shared_slot("sync", environ=env, redis_factory=factory)
    assert try_claim_shared_slot("sync", 2, environ=env, redis_factory=factory) is True


def test_shared_slot_fail_closed():
    assert (
        try_claim_shared_slot(
            "sync",
            2,
            fail_closed=True,
            environ={"REDIS_URL": "redis://test"},
            redis_factory=lambda: FakeRedis(fail=True),
        )
        is False
    )
