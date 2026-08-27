"""
የቤተ ክርስቲያን ወቅቶች -- the liturgical seasons of the year.

Seasons are resolved by precedence, not adjacency: the paschal cycle (Lent
through Pentecost) overlays the fixed year, and within it Holy Week outranks
plain Lent. Whatever is left is ordinary time (ዘመነ ጽጌ is a flower-season
subdivision of ordinary time kept between Meskerem 26 and Hidar 5).

The ``theme`` field is a UI hint: apps theming by season get a stable key
rather than having to parse names.

Port of ts/src/core/seasons.ts.
"""

from __future__ import annotations

from typing import Any

from .bahirehasab import movable_feast_jdn
from .ethiopic import ethiopic_to_jdn, jdn_to_ethiopic


def _mk(key, amharic, translit, english, theme, start, end) -> dict[str, Any]:
    return {"key": key, "amharic": amharic, "translit": translit,
            "english": english, "theme": theme, "startJDN": start, "endJDN": end}


def season_of(jdn: int) -> dict[str, Any]:
    """The season a JDN falls in. Paschal overlay first, then fixed seasons."""
    year = jdn_to_ethiopic(jdn).year

    # Paschal cycle candidates from the years whose cycle could cover this date.
    for y in (year + 1, year, year - 1):
        if y < 1:
            continue
        nineveh = movable_feast_jdn(y, "nineveh")
        lent_start = movable_feast_jdn(y, "abiy_tsome")
        hosanna = movable_feast_jdn(y, "hosanna")
        fasika = movable_feast_jdn(y, "fasika")
        pentecost = movable_feast_jdn(y, "peraklitos")

        if nineveh <= jdn <= nineveh + 2:
            return _mk("nineveh", "ጾመ ነነዌ", "Tsome Nenewe", "Fast of Nineveh",
                       "fasting", nineveh, nineveh + 2)
        if hosanna <= jdn < fasika:
            return _mk("himamat", "ሰሙነ ሕማማት", "Semune Himamat", "Holy Week",
                       "fasting", hosanna, fasika - 1)
        if lent_start <= jdn < hosanna:
            return _mk("abiy_tsome", "ዓቢይ ጾም", "Abiy Tsome", "Great Lent",
                       "fasting", lent_start, hosanna - 1)
        if fasika <= jdn <= pentecost:
            return _mk("hamsa", "ሃምሳ (ዘመነ ትንሣኤ)", "Hamsa", "The Fifty Days of Eastertide",
                       "feast", fasika, pentecost)

    # Fixed seasons of the Ethiopian year containing the date.
    e = jdn_to_ethiopic(jdn)

    def ec(m: int, d: int) -> int:
        return ethiopic_to_jdn(e.year, m, d)

    # ዘመነ ጽጌ: Meskerem 26 - Hidar 5, the season of flowers.
    if ec(1, 26) <= jdn <= ec(3, 5):
        return _mk("tsige", "ዘመነ ጽጌ", "Zemene Tsige", "Season of Flowers",
                   "ordinary", ec(1, 26), ec(3, 5))
    # ዘመነ ስብከት/ልደት: Advent, Hidar 15 to Gena eve.
    if ec(3, 15) <= jdn <= ec(4, 28):
        return _mk("sibket", "ዘመነ ስብከት", "Zemene Sibket", "Season of Proclamation (Advent)",
                   "fasting", ec(3, 15), ec(4, 28))
    # ዘመነ አስተርእዮ: Theophany season, Gena to the eve of Nineveh of the same EC year.
    nin = movable_feast_jdn(e.year, "nineveh")
    if ec(4, 29) <= jdn < nin:
        return _mk("astereyo", "ዘመነ አስተርእዮ", "Zemene Astere'iyo", "Season of Epiphany",
                   "feast", ec(4, 29), nin - 1)

    # Everything else: ordinary time.
    return _mk("ordinary", "ዘመነ ዮሐንስ/ማቴዎስ/ማርቆስ/ሉቃስ", "Ordinary Time", "Ordinary Time",
               "ordinary", jdn, jdn)
