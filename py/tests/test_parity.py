"""
Asserts the FastAPI service returns byte-identical JSON to the Hono service.

spec/responses.json is produced by ts/scripts/dump-responses.ts. Replaying the
same routes here is what makes "two implementations" safe: any divergence in
routing, serialization, error shape or status code fails immediately.
"""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

from eotc.api import app

SPEC = Path(__file__).resolve().parents[2] / "spec"
EXPECTED = json.loads((SPEC / "responses.json").read_text(encoding="utf-8"))

@pytest.mark.parametrize("route", list(EXPECTED))
@pytest.mark.anyio
async def test_matches_hono(route: str) -> None:
    want = EXPECTED[route]
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        if route.startswith("POST "):
            # "POST /path #N" -> replay batch case N from batch-cases.json.
            idx = int(route.rsplit("#", 1)[1])
            payload = json.loads((SPEC / "batch-cases.json").read_text(encoding="utf-8"))[idx]
            res = await client.post("/v1/calendar/convert/batch", json=payload)
        else:
            res = await client.get(route)
    assert res.status_code == want["status"], (
        f"{route}: status {res.status_code} != {want['status']}"
    )
    assert res.json() == want["body"], f"{route}: body differs from the Hono implementation"


ICS = json.loads((SPEC / "responses-ics.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("route", list(ICS))
@pytest.mark.anyio
async def test_ics_byte_identical(route: str) -> None:
    """The .ics feeds must match the Hono output byte for byte -- calendar
    apps poll these URLs, so both deployments must serve identical files."""
    want = ICS[route]
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        res = await client.get(route)
    assert res.status_code == want["status"]
    assert res.headers["content-type"].startswith("text/calendar")
    assert res.text == want["body"], f"{route}: ics bytes differ"


def test_every_route_covered() -> None:
    routes = json.loads((SPEC / "routes.json").read_text(encoding="utf-8"))
    gets = {r for r in EXPECTED if not r.startswith("POST ")}
    assert set(routes) == gets, "routes.json and responses.json are out of sync"


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"
