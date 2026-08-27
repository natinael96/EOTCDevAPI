"""
The canonical "day" payload -- the single object every endpoint that describes a
date returns. Mirrors ts/src/core/day.ts exactly so both services are
byte-compatible.
"""

from __future__ import annotations

from typing import Any

from .bahirehasab import movable_feasts
from .ethiopic import (
    MONTHS, WEEKDAYS, days_in_ethiopic_month, is_ethiopic_leap_year,
    jdn_to_ethiopic, jdn_to_gregorian, jdn_to_weekday,
)
from .fasts import fasting_status
from .feasts import commemorations_on, fixed_feasts_on


def iso(jdn: int) -> str:
    g = jdn_to_gregorian(jdn)
    return f"{g.year:04d}-{g.month:02d}-{g.day:02d}"


def eth_iso(y: int, m: int, d: int) -> str:
    return f"{y:04d}-{m:02d}-{d:02d}"


def describe_day(jdn: int) -> dict[str, Any]:
    """Everything the API knows about a single day."""
    g = jdn_to_gregorian(jdn)
    e = jdn_to_ethiopic(jdn)
    wd = jdn_to_weekday(jdn)
    month = MONTHS[e.month - 1]
    status = fasting_status(jdn, e.year)

    # A movable feast landing on this exact day, if any.
    movable = [
        {"key": f["key"], "amharic": f["amharic"], "translit": f["translit"],
         "english": f["english"], "movable": True}
        for y in (e.year - 1, e.year, e.year + 1) if y >= 1
        for f in movable_feasts(y) if f["jdn"] == jdn
    ]

    fixed = [
        {"key": f["key"], "amharic": f["amharic"], "translit": f["translit"],
         "english": f["english"], "major": f["major"], "movable": False}
        for f in fixed_feasts_on(e.year, e.month, e.day)
    ]

    return {
        "jdn": jdn,
        "gregorian": {"date": iso(jdn), "year": g.year, "month": g.month, "day": g.day},
        "ethiopic": {
            "date": eth_iso(e.year, e.month, e.day),
            "year": e.year, "month": e.month, "day": e.day,
            "monthName": {"amharic": month["amharic"], "translit": month["translit"]},
            "isLeapYear": is_ethiopic_leap_year(e.year),
            "daysInMonth": days_in_ethiopic_month(e.year, e.month),
        },
        "weekday": {"n": wd, **WEEKDAYS[wd]},
        "fasting": {
            "isFasting": status["isFasting"],
            "weeklyFast": status["weeklyFast"],
            "fastFreeSeason": status["fastFreeSeason"],
            "feastOverride": status["feastOverride"],
            "reason": status["reason"],
            "periods": [
                {"key": p["key"], "amharic": p["amharic"], "translit": p["translit"],
                 "english": p["english"], "start": iso(p["startJDN"]), "end": iso(p["endJDN"]),
                 "days": p["days"], "movable": p["movable"],
                 "dayOfPeriod": jdn - p["startJDN"] + 1}
                for p in status["periods"]
            ],
        },
        "feasts": movable + fixed,
        "commemorations": [
            {"amharic": c["amharic"], "translit": c["translit"], "english": c["english"]}
            for c in commemorations_on(e.year, e.month, e.day)
        ],
    }
