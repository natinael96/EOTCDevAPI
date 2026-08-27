"""Rate-limit policy and HTTP contract tests for self-hosted FastAPI."""

from __future__ import annotations

import httpx
import pytest

from eotc.api import _TokenBucketLimiter, _rate_limiter, app


def test_token_bucket_refills_and_isolates_clients() -> None:
    limiter = _TokenBucketLimiter()
    assert limiter.take("a", 2, 0.5, now=0) == (True, 0)
    assert limiter.take("a", 2, 0.5, now=0) == (True, 0)
    assert limiter.take("a", 2, 0.5, now=0) == (False, 2)
    assert limiter.take("a", 2, 0.5, now=1) == (False, 1)
    assert limiter.take("a", 2, 0.5, now=2) == (True, 0)
    assert limiter.take("b", 2, 0.5, now=0) == (True, 0)


@pytest.mark.anyio
async def test_rate_limit_http_contract(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EOTC_RATE_CAPACITY", "1")
    monkeypatch.setenv("EOTC_RATE_REFILL_PER_SECOND", "0.1")
    _rate_limiter._buckets.clear()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        first = await client.get("/v1/date/2026-04-12")
        limited = await client.get("/v1/date/2026-04-12")
        health = await client.get("/v1/health")

    assert first.status_code == 200
    assert limited.status_code == 429
    assert limited.headers["retry-after"] == "10"
    assert limited.headers["cache-control"] == "no-store"
    assert limited.json() == {
        "error": "rate_limited",
        "message": "Too many requests. Please retry after 10 seconds.",
        "retryAfter": 10,
    }
    assert health.status_code == 200


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"
