import os
from contextlib import asynccontextmanager
from typing import AsyncIterator

import asyncpg


_LOCK_NAME = "gavel-investment-analysis"
HEAVY_WORKER_LOCK = "gavel-heavy-worker"


@asynccontextmanager
async def try_analysis_run_lock() -> AsyncIterator[bool]:
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    acquired = False
    try:
        acquired = bool(
            await conn.fetchval(
                "SELECT pg_try_advisory_lock(hashtext($1::text))",
                _LOCK_NAME,
            )
        )
        yield acquired
    finally:
        if acquired:
            await conn.fetchval(
                "SELECT pg_advisory_unlock(hashtext($1::text))",
                _LOCK_NAME,
            )
        await conn.close()


@asynccontextmanager
async def hold_heavy_run_lock() -> AsyncIterator[None]:
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    try:
        await conn.fetchval(
            "SELECT pg_advisory_lock(hashtext($1::text))",
            HEAVY_WORKER_LOCK,
        )
        yield
    finally:
        await conn.fetchval(
            "SELECT pg_advisory_unlock(hashtext($1::text))",
            HEAVY_WORKER_LOCK,
        )
        await conn.close()
