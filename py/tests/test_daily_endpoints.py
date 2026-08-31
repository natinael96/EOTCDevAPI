"""
The daily-companion surfaces: /v1/today's optional payloads, Sinksar search,
and the readings calendar feed. Mirrors the matching describe blocks in
ts/test/api.test.ts so both implementations are pinned to one contract.

Clock-dependent routes cannot live in the shared golden fixtures, so
/v1/today's behavior is asserted here in both suites instead.
"""

from __future__ import annotations

from urllib.parse import quote

from fastapi.testclient import TestClient

from eotc.api import app

client = TestClient(app)


def test_today_default_response_is_unchanged() -> None:
    body = client.get("/v1/today").json()
    assert "readings" not in body
    assert "sinksar" not in body


def test_today_includes_readings_and_commemorations() -> None:
    body = client.get("/v1/today?include=readings,sinksar").json()
    assert body["readings"]["source"]["resolution"] == "fixed_candidate_only"
    assert "liturgy" in body["readings"]["services"]
    assert isinstance(body["sinksar"]["annual"], list)
    assert isinstance(body["sinksar"]["monthly"], list)
    # The same day fetched on its own must list the same commemorations.
    standalone = client.get(f"/v1/sinksar/{body['gregorian']['date']}").json()
    assert body["sinksar"]["annual"] == [
        item["title"] for item in standalone["annualFeasts"]["items"]
    ]


def test_today_rejects_an_unknown_include() -> None:
    res = client.get("/v1/today?include=bogus")
    assert res.status_code == 400
    assert "readings" in res.json()["hint"]


def test_sinksar_search_finds_a_commemoration_by_name() -> None:
    res = client.get(f"/v1/sinksar/search?q={quote('እንድርያኖስ')}")
    assert res.status_code == 200
    body = res.json()
    assert body["count"] > 0
    assert "እንድርያኖስ" in body["matches"][0]["title"]
    # Nehase 25 is where the Sinksar keeps Endryanos.
    assert any(m["ethiopianMonth"] == 12 and m["ethiopianDay"] == 25
               for m in body["matches"])


def test_sinksar_search_resolves_dates_for_a_year() -> None:
    body = client.get(f"/v1/sinksar/search?q={quote('ሚካኤል')}&year=2018").json()
    assert body["ethiopicYear"] == 2018
    monthly = next(m for m in body["matches"] if m["kind"] == "monthly")
    assert len(monthly["date"]["gregorian"]) == 10
    assert monthly["date"]["weekday"]["english"]


def test_sinksar_search_does_not_shadow_the_date_route() -> None:
    assert client.get("/v1/sinksar/2026-08-31").status_code == 200
    missing = client.get("/v1/sinksar/search")
    assert missing.status_code == 400
    assert "'q'" in missing.json()["message"]


def test_readings_calendar_feed() -> None:
    res = client.get("/v1/calendar/ics?year=2018&type=readings")
    assert res.status_code == 200
    text = res.text
    assert "BEGIN:VCALENDAR" in text
    assert "CATEGORIES:READING" in text
    # One event per day of the year, and the corrected psalm numbering.
    assert text.count("BEGIN:VEVENT") == 365
    assert "መዝሙ 65:11-12" in text


def test_readings_feed_rejects_an_unknown_type() -> None:
    assert client.get("/v1/calendar/ics?year=2018&type=bogus").status_code == 400
