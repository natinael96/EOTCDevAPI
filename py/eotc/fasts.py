"""
አጽዋማት -- the seven canonical fasts of the Ethiopian Orthodox Tewahedo Church,
and the rule for deciding whether any given day is a fasting day.

Two kinds of fast live here:

- Fixed:   anchored to Ethiopian calendar dates (Filseta, Nebiyat, Gahad)
- Movable: anchored to Nineveh via Bahire Hasab (Nineveh, Lent, Apostles')

Plus the weekly ጾመ ድህነት: every Wednesday and Friday, suspended during the
fifty days from Fasika to Pentecost (ሃምሳ) when no weekly fast is kept.

Port of ts/src/core/fasts.ts.
"""

from __future__ import annotations

from typing import Any

from .bahirehasab import bahire_hasab, movable_feast_jdn
from .ethiopic import days_in_ethiopic_month, ethiopic_to_jdn, jdn_to_weekday

#: Great feasts of the Lord that lift the weekly Wednesday/Friday fast when
#: they fall on one, as (month, day). Gena and Timket are the two outside the
#: paschal season; the fifty days after Fasika are handled by fast_free_season.
WEEKLY_FAST_EXEMPT = [
    (4, 29),  # ገና      Gena   -- the Nativity
    (5, 11),  # ጥምቀት    Timket -- Theophany
]


def fast_periods(year: int) -> list[dict[str, Any]]:
    """
    Every dated fasting period of an Ethiopian year, chronologically.
    The weekly Wed/Fri fast is not a period; see ``fasting_status``.
    """
    nineveh = bahire_hasab(year)["ninevehJDN"]
    fasika = movable_feast_jdn(year, "fasika")
    pentecost = movable_feast_jdn(year, "peraklitos")

    def ec(m: int, d: int) -> int:
        return ethiopic_to_jdn(year, m, d)

    def mk(key, amharic, translit, english, start, end, movable, description):
        return {"key": key, "amharic": amharic, "translit": translit,
                "english": english, "startJDN": start, "endJDN": end,
                "days": end - start + 1, "movable": movable,
                "description": description}

    periods = [
        mk("tsome_nebiyat", "ጾመ ነቢያት", "Tsome Nebiyat", "Prophets' Fast (Advent)",
           ec(3, 15), ec(4, 28), False,
           "From Hidar 15 to the eve of Gena, kept in expectation of the Nativity."),
        mk("gahad_gena", "ጾመ ገሃድ (ገና)", "Tsome Gahad (Gena)", "Christmas Eve Fast",
           ec(4, 28), ec(4, 28), False,
           "The strict single-day fast on the eve of the Nativity."),
        mk("gahad_timket", "ጾመ ገሃድ (ጥምቀት)", "Tsome Gahad (Timket)", "Epiphany Eve Fast",
           ec(5, 10), ec(5, 10), False,
           "The strict single-day fast on the eve of Timket."),
        mk("tsome_nenewe", "ጾመ ነነዌ", "Tsome Nenewe", "Fast of Nineveh",
           nineveh, nineveh + 2, True,
           "Three days recalling Jonah's preaching to Nineveh. Always Monday to Wednesday."),
        mk("abiy_tsome", "ዓቢይ ጾም", "Abiy Tsome (Hudade)", "Great Lent",
           nineveh + 14, fasika - 1, True,
           "Fifty-five days: the eight-day ጾመ ሕርቃል, the Forty Days, and Holy Week (ሰሙነ ሕማማት)."),
        mk("tsome_hawaryat", "ጾመ ሐዋርያት", "Tsome Hawaryat", "Apostles' Fast",
           pentecost + 1, ec(11, 5), True,
           "From the Monday after Pentecost until Hamle 5, the feast of Peter and Paul."),
        mk("tsome_filseta", "ጾመ ፍልሰታ", "Tsome Filseta", "Fast of the Assumption",
           ec(12, 1), ec(12, 16), False,
           "Sixteen days for the Assumption of the Virgin Mary. Widely kept by the laity."),
    ]
    return sorted(periods, key=lambda p: p["startJDN"])


def fasting_status(jdn: int, ethiopic_year: int) -> dict[str, Any]:
    """
    Decide whether a JDN is a fasting day.

    The year boundary matters: a JDN near the edges of an Ethiopian year can
    fall inside a period belonging to a neighbouring year (the Apostles' Fast
    can run long, Advent starts in Hidar), so neighbours are checked too.
    """
    neighbours = [y for y in (ethiopic_year - 1, ethiopic_year, ethiopic_year + 1) if y >= 1]

    periods = [p for y in neighbours for p in fast_periods(y)
               if p["startJDN"] <= jdn <= p["endJDN"]]

    # ሃምሳ -- the fifty days from Fasika to Pentecost inclusive, when the weekly
    # Wednesday/Friday fast is suspended.
    fast_free_season = any(
        movable_feast_jdn(y, "fasika") <= jdn <= movable_feast_jdn(y, "peraklitos")
        for y in neighbours
    )

    # A great feast of the Lord outranks the weekly fast.
    feast_override = any(
        ethiopic_to_jdn(y, m, d) == jdn for y in neighbours for (m, d) in WEEKLY_FAST_EXEMPT
    )

    weekday = jdn_to_weekday(jdn)
    is_wed_or_fri = weekday in (3, 5)
    weekly_fast = is_wed_or_fri and not fast_free_season and not feast_override
    is_fasting = len(periods) > 0 or weekly_fast

    if feast_override and not periods:
        reason = "Not a fasting day: a great feast of the Lord lifts the weekly fast."
    elif periods:
        reason = "; ".join(f"{p['amharic']} ({p['english']})" for p in periods)
    elif weekly_fast:
        reason = f"ጾመ ድህነት -- the weekly {'Wednesday' if weekday == 3 else 'Friday'} fast"
    elif is_wed_or_fri and fast_free_season:
        reason = "Not a fasting day: the weekly fast is lifted during the fifty days after Fasika."
    else:
        reason = "Not a fasting day."

    return {"isFasting": is_fasting, "periods": periods, "weeklyFast": weekly_fast,
            "fastFreeSeason": fast_free_season, "feastOverride": feast_override,
            "reason": reason}


def fasting_day_count(year: int) -> int:
    """Count of fasting days in an Ethiopian year -- useful as a sanity check."""
    return sum(
        1
        for m in range(1, 14)
        for d in range(1, days_in_ethiopic_month(year, m) + 1)
        if fasting_status(ethiopic_to_jdn(year, m, d), year)["isFasting"]
    )
