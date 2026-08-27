"""
ባሕረ ሐሳብ (Bahire Hasab) -- "the sea of thought", the traditional EOTC
computation that fixes every movable feast for an Ethiopian year.

The chain is::

    Amete Alem -> Medeb -> Wenber -> Abekte & Metqi -> Mebaja Hamer
    -> (weekday + Tewsak) -> ጾመ ነነዌ (Nineveh) -> every other movable feast

Nineveh is the linchpin: all ten remaining movable feasts sit a fixed number of
days after it (the Tewsak offsets in MOVABLE_FEASTS).

Port of ts/src/core/bahirehasab.ts.
"""

from __future__ import annotations

from typing import Any

from .ethiopic import AMETE_FIDA, ethiopic_to_jdn, jdn_to_ethiopic, jdn_to_weekday

#: The four-year evangelist cycle. Index = Amete Alem % 4.
EVANGELISTS = [
    {"amharic": "ዮሐንስ", "translit": "Yohannes", "english": "John"},
    {"amharic": "ማቴዎስ", "translit": "Matewos",  "english": "Matthew"},
    {"amharic": "ማርቆስ", "translit": "Marqos",   "english": "Mark"},
    {"amharic": "ሉቃስ",  "translit": "Luqas",    "english": "Luke"},
]

#: ተውሳክ -- days added to the Mebaja Hamer *day-number*, indexed by Mebaja
#: Hamer's weekday (0 = Sunday). This is day-of-month arithmetic, not a JDN
#: offset: the count starts from the same day-number four months later
#: (Meskerem -> Tir, Tikimt -> Yekatit).
#:
#: Ethiopian months are all exactly 30 days and 30 % 7 == 2, so four months on
#: is 120 days and 120 % 7 == 1 -- the weekday advances by exactly one. That
#: makes every entry land on a Monday, with the offset always in 2..8.
TEWSAK_NINEVEH = [7, 6, 5, 4, 3, 2, 8]

#: Each movable feast as a day offset from Nineveh.
MOVABLE_FEASTS = [
    {"key": "nineveh",        "offset": 0,   "amharic": "ጾመ ነነዌ",       "translit": "Tsome Nenewe",       "english": "Fast of Nineveh"},
    {"key": "abiy_tsome",     "offset": 14,  "amharic": "ዓቢይ ጾም",       "translit": "Abiy Tsome",         "english": "Great Lent begins"},
    {"key": "debre_zeit",     "offset": 41,  "amharic": "ደብረ ዘይት",      "translit": "Debre Zeit",         "english": "Mount of Olives (mid-Lent)"},
    {"key": "hosanna",        "offset": 62,  "amharic": "ሆሳዕና",         "translit": "Hosanna",            "english": "Palm Sunday"},
    {"key": "siklet",         "offset": 67,  "amharic": "ስቅለት",         "translit": "Siklet",             "english": "Good Friday"},
    {"key": "fasika",         "offset": 69,  "amharic": "ትንሣኤ",         "translit": "Tinsae/Fasika",      "english": "Easter (Resurrection)"},
    {"key": "rikbe_kahnat",   "offset": 93,  "amharic": "ርክበ ካህናት",     "translit": "Rikbe Kahnat",       "english": "Assembly of the Priests"},
    {"key": "erget",          "offset": 108, "amharic": "ዕርገት",         "translit": "Erget",              "english": "Ascension"},
    {"key": "peraklitos",     "offset": 118, "amharic": "በዓለ ጰራቅሊጦስ",   "translit": "Be'ale Peraklitos",  "english": "Pentecost"},
    {"key": "tsome_hawaryat", "offset": 119, "amharic": "ጾመ ሐዋርያት",     "translit": "Tsome Hawaryat",     "english": "Apostles' Fast begins"},
    {"key": "tsome_dihnet",   "offset": 121, "amharic": "ጾመ ድህነት",      "translit": "Tsome Dihnet",       "english": "Fast of Salvation begins"},
]


def bahire_hasab(year: int) -> dict[str, Any]:
    """Run the Bahire Hasab chain for an Ethiopian (Amete Mihret) year."""
    if not isinstance(year, int) or isinstance(year, bool) or year < 1:
        raise ValueError(f"Ethiopian year must be a positive integer, got {year}")

    amete_alem = AMETE_FIDA + year
    medeb = amete_alem % 19
    wenber = 18 if medeb == 0 else medeb - 1
    abekte = (wenber * 11) % 30
    metqi = (wenber * 19) % 30

    # Metqi 0 is read as the 30th -- there is no "day zero" -- and that reading
    # happens *before* the month test, so a zero Metqi lands in Meskerem, not
    # Tikimt. (Verified: Meskerem 30 is the only position that reproduces
    # Alexandrian Fasika for all 21 wenber=0 years between 1800-2200 EC.)
    effective_metqi = 30 if metqi == 0 else metqi
    mh_month = 1 if effective_metqi > 14 else 2   # 1 = Meskerem, 2 = Tikimt
    mh_day = effective_metqi

    mh_jdn = ethiopic_to_jdn(year, mh_month, mh_day)
    mh_weekday = jdn_to_weekday(mh_jdn)

    # Nineveh is counted from the same day-number four months after Mebaja
    # Hamer: Meskerem -> Tir, Tikimt -> Yekatit. Adding the Tewsak there always
    # lands on the Monday that opens the fast.
    nineveh_jdn = ethiopic_to_jdn(year, mh_month + 4, mh_day) + TEWSAK_NINEVEH[mh_weekday]

    return {
        "ameteMihret": year,
        "ameteAlem": amete_alem,
        "evangelist": {**EVANGELISTS[amete_alem % 4], "yearOfCycle": amete_alem % 4},
        "medeb": medeb,
        "wenber": wenber,
        "abekte": abekte,
        "metqi": metqi,
        "mebajaHamer": {"year": year, "month": mh_month, "day": mh_day, "weekday": mh_weekday},
        "meskeremOneWeekday": jdn_to_weekday(ethiopic_to_jdn(year, 1, 1)),
        "ninevehJDN": nineveh_jdn,
    }


def movable_feast_jdn(year: int, key: str) -> int:
    """JDN of one movable feast in the given Ethiopian year."""
    feast = next((f for f in MOVABLE_FEASTS if f["key"] == key), None)
    if feast is None:
        raise ValueError(f"unknown movable feast {key!r}")
    return bahire_hasab(year)["ninevehJDN"] + feast["offset"]


def movable_feasts(year: int) -> list[dict[str, Any]]:
    """Every movable feast for the year, in chronological order."""
    nineveh = bahire_hasab(year)["ninevehJDN"]
    out = []
    for f in MOVABLE_FEASTS:
        jdn = nineveh + f["offset"]
        e = jdn_to_ethiopic(jdn)
        out.append({**f, "jdn": jdn,
                    "ethiopic": {"year": e.year, "month": e.month, "day": e.day},
                    "weekday": jdn_to_weekday(jdn)})
    return out


# --- Independent cross-check: the Alexandrian computus -------------------

def julian_to_jdn(year: int, month: int, day: int) -> int:
    """JDN from a *Julian*-calendar date (the computus works in Julian reckoning)."""
    a = (14 - month) // 12
    y = year + 4800 - a
    m = month + 12 * a - 3
    return day + (153 * m + 2) // 5 + 365 * y + y // 4 - 32083


def alexandrian_easter_jdn(gregorian_year: int) -> int:
    """
    Alexandrian (Julian) computus -- the Meeus algorithm. Returns the JDN of
    Orthodox Easter for a Gregorian year. Used only to verify Bahire Hasab.
    """
    a = gregorian_year % 4
    b = gregorian_year % 7
    c = gregorian_year % 19
    d = (19 * c + 15) % 30
    e = (2 * a + 4 * b - d + 34) % 7
    month = (d + e + 114) // 31
    day = ((d + e + 114) % 31) + 1
    return julian_to_jdn(gregorian_year, month, day)
