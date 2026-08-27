"""
Asserts the Python implementation reproduces spec/conformance.json exactly.

The fixture is generated from the TypeScript core by
ts/scripts/gen-conformance.ts. Both implementations assert against it, so any
divergence between them fails a build rather than silently shipping.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from eotc.bahirehasab import alexandrian_easter_jdn, bahire_hasab, movable_feasts
from eotc.ethiopic import (
    days_in_ethiopic_month, ethiopic_to_jdn, is_ethiopic_leap_year,
    jdn_to_ethiopic, jdn_to_gregorian, jdn_to_weekday,
)
from eotc.fasts import fast_periods, fasting_day_count, fasting_status
from eotc.feasts import commemorations_on, fixed_feasts, fixed_feasts_on
from eotc.geez import from_geez, to_geez
from eotc.seasons import season_of

FIXTURE = Path(__file__).resolve().parents[2] / "spec" / "conformance.json"


@pytest.fixture(scope="session")
def cases():
    assert FIXTURE.exists(), f"missing fixture: {FIXTURE} (run gen-conformance.ts)"
    return json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]


def test_conversion(cases):
    for c in cases["conversion"]:
        jdn = c["jdn"]
        g, e = jdn_to_gregorian(jdn), jdn_to_ethiopic(jdn)
        assert list(g) == c["gregorian"], f"gregorian at jdn={jdn}"
        assert list(e) == c["ethiopic"], f"ethiopic at jdn={jdn}"
        assert jdn_to_weekday(jdn) == c["weekday"], f"weekday at jdn={jdn}"


def test_year_shape(cases):
    for c in cases["year_shape"]:
        y = c["year"]
        assert is_ethiopic_leap_year(y) == c["leap"], f"leap {y}"
        assert days_in_ethiopic_month(y, 13) == c["pagumen"], f"pagumen {y}"
        assert ethiopic_to_jdn(y, 1, 1) == c["newYearJDN"], f"new year {y}"


def test_bahire_hasab(cases):
    for c in cases["bahire_hasab"]:
        y = c["year"]
        b = bahire_hasab(y)
        assert b["ameteAlem"] == c["ameteAlem"], f"ameteAlem {y}"
        assert b["evangelist"]["translit"] == c["evangelist"], f"evangelist {y}"
        assert b["medeb"] == c["medeb"], f"medeb {y}"
        assert b["wenber"] == c["wenber"], f"wenber {y}"
        assert b["abekte"] == c["abekte"], f"abekte {y}"
        assert b["metqi"] == c["metqi"], f"metqi {y}"
        mh = b["mebajaHamer"]
        assert [mh["month"], mh["day"], mh["weekday"]] == c["mebajaHamer"], f"mebajaHamer {y}"
        assert b["ninevehJDN"] == c["ninevehJDN"], f"nineveh {y}"


def test_bahire_hasab_agrees_with_computus(cases):
    """The traditional route and the Alexandrian computus must never disagree."""
    for c in cases["bahire_hasab"]:
        fasika = c["ninevehJDN"] + 69
        assert fasika == c["alexandrianEasterJDN"], (
            f"EC {c['year']}: Bahire Hasab Fasika {jdn_to_gregorian(fasika)} != "
            f"Alexandrian {jdn_to_gregorian(c['alexandrianEasterJDN'])}"
        )
        assert alexandrian_easter_jdn(c["year"] + 8) == c["alexandrianEasterJDN"]


def test_movable_feasts(cases):
    for c in cases["movable_feasts"]:
        got = [[f["key"], f["jdn"], f["weekday"]] for f in movable_feasts(c["year"])]
        assert got == c["feasts"], f"movable feasts {c['year']}"


def test_fast_periods(cases):
    for c in cases["fast_periods"]:
        got = [[p["key"], p["startJDN"], p["endJDN"], p["days"], p["movable"]]
               for p in fast_periods(c["year"])]
        assert got == c["periods"], f"fast periods {c['year']}"


def test_fasting_status(cases):
    for c in cases["fasting_status"]:
        y, m, d = c["ethiopic"]
        s = fasting_status(c["jdn"], y)
        where = f"{y}-{m:02d}-{d:02d} (jdn {c['jdn']})"
        assert s["isFasting"] == c["isFasting"], f"isFasting {where}"
        assert s["weeklyFast"] == c["weeklyFast"], f"weeklyFast {where}"
        assert s["fastFreeSeason"] == c["fastFreeSeason"], f"fastFreeSeason {where}"
        assert s["feastOverride"] == c["feastOverride"], f"feastOverride {where}"
        assert [p["key"] for p in s["periods"]] == c["periodKeys"], f"periods {where}"


def test_fasting_day_count(cases):
    for c in cases["fasting_day_count"]:
        assert fasting_day_count(c["year"]) == c["count"], f"count {c['year']}"


def test_fixed_feasts(cases):
    for c in cases["fixed_feasts"]:
        got = [[f["key"], f["jdn"], f["weekday"]] for f in fixed_feasts(c["year"])]
        assert got == c["feasts"], f"fixed feasts {c['year']}"


def test_commemorations(cases):
    for c in cases["commemorations"]:
        d = c["day"]
        assert [x["translit"] for x in commemorations_on(2018, 6, d)] == c["monthly"], f"monthly {d}"
        assert [f["key"] for f in fixed_feasts_on(2018, 9, d)] == c["fixedOnGinbot"], f"fixed {d}"


def test_geez(cases):
    for c in cases["geez"]:
        assert to_geez(c["n"]) == c["geez"], f"geez {c['n']}"
        assert from_geez(c["geez"]) == c["n"], f"geez round-trip {c['n']}"


def test_seasons(cases):
    for c in cases["seasons"]:
        s = season_of(c["jdn"])
        assert s["key"] == c["key"], f"season at jdn {c['jdn']}"
        assert s["theme"] == c["theme"], f"theme at jdn {c['jdn']}"
        assert s["startJDN"] == c["startJDN"], f"season start at jdn {c['jdn']}"
        assert s["endJDN"] == c["endJDN"], f"season end at jdn {c['jdn']}"
