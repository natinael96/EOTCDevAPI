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


@pytest.mark.anyio
async def test_cache_policy_distinguishes_clock_dependent_routes() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        today = await client.get("/v1/today")
        upcoming = await client.get("/v1/upcoming?days=5")
        dated_upcoming = await client.get("/v1/upcoming?from=2026-04-01&days=5")
        dated = await client.get("/v1/date/2026-04-12")
        health = await client.get("/v1/health")

    assert today.headers["cache-control"] == "public, max-age=60, must-revalidate"
    assert upcoming.headers["cache-control"] == "public, max-age=60, must-revalidate"
    assert dated_upcoming.headers["cache-control"] == "public, max-age=86400"
    assert dated.headers["cache-control"] == "public, max-age=86400"
    assert health.headers["cache-control"] == "no-store"


@pytest.mark.anyio
async def test_upcoming_is_limited_to_thirty_days() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        allowed = await client.get("/v1/upcoming?from=2026-04-01&days=30")
        too_long = await client.get("/v1/upcoming?from=2026-04-01&days=31")

    assert allowed.status_code == 200
    assert too_long.status_code == 400
    assert "1 to 30" in too_long.json()["message"]


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"
