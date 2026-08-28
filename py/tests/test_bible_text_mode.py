"""
Self-host Bible text mode: EOTC_BIBLE_TEXT_DIR activates verse text serving.

These tests run only where the licensed local editions exist (they are absent
in CI); the public no-text behavior is covered by the shared response
fixtures instead, so the two deployment modes are each pinned by a test.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from eotc.api import app

BIBLE_DIR = Path(__file__).resolve().parents[2] / "data" / "bible"

pytestmark = pytest.mark.skipif(
    not (BIBLE_DIR / "am-1980" / "books").exists(),
    reason="licensed local Bible editions not present",
)


def test_text_served_when_edition_present(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EOTC_BIBLE_TEXT_DIR", str(BIBLE_DIR))
    response = TestClient(app).get("/v1/bible/am-1980/JHN/3")
    assert response.status_code == 200
    body = response.json()
    assert body["textAvailable"] is True
    assert body["reason"] is None
    assert len(body["verses"]) == body["verseCount"]
    verse16 = next(verse for verse in body["verses"] if verse["n"] == 16)
    assert verse16["text"]
    assert verse16["geezNumeral"]


def test_text_unavailable_without_env() -> None:
    response = TestClient(app).get("/v1/bible/am-1980/JHN/3")
    assert response.status_code == 200
    body = response.json()
    assert body["textAvailable"] is False
    assert body["verses"] is None
