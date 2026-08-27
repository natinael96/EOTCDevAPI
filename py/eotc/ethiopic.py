"""
Ethiopian <-> Gregorian calendar conversion.

The Ethiopian (Ge'ez) calendar has 13 months: twelve of exactly 30 days, plus
Pagumen, a short 13th month of 5 days (6 in a leap year). A year is leap when
``year % 4 == 3`` -- the Year of Luke (ዘመነ ሉቃስ).

All conversion goes through the Julian Day Number (JDN), an integer count of
days that is calendar-agnostic. Converting A->JDN->B keeps the two calendars
from ever needing to know about each other.

Port of ts/src/core/ethiopic.ts -- the two must stay in lockstep, which
tests/test_conformance.py enforces against spec/conformance.json.
"""

from __future__ import annotations

from typing import NamedTuple

#: JDN of Meskerem 1, 1 EC (Amete Mihret epoch) = 29 August 8 CE (Julian).
JDN_EPOCH_AMETE_MIHRET = 1723856

#: Amete Alem (Year of the World) = Amete Mihret + this. Used by Bahire Hasab.
AMETE_FIDA = 5500

MONTHS = [
    {"n": 1,  "amharic": "መስከረም", "translit": "Meskerem"},
    {"n": 2,  "amharic": "ጥቅምት",  "translit": "Tikimt"},
    {"n": 3,  "amharic": "ኅዳር",   "translit": "Hidar"},
    {"n": 4,  "amharic": "ታኅሣሥ",  "translit": "Tahsas"},
    {"n": 5,  "amharic": "ጥር",    "translit": "Tir"},
    {"n": 6,  "amharic": "የካቲት",  "translit": "Yekatit"},
    {"n": 7,  "amharic": "መጋቢት",  "translit": "Megabit"},
    {"n": 8,  "amharic": "ሚያዝያ",  "translit": "Miyazya"},
    {"n": 9,  "amharic": "ግንቦት",  "translit": "Ginbot"},
    {"n": 10, "amharic": "ሰኔ",    "translit": "Sene"},
    {"n": 11, "amharic": "ሐምሌ",   "translit": "Hamle"},
    {"n": 12, "amharic": "ነሐሴ",   "translit": "Nehase"},
    {"n": 13, "amharic": "ጳጉሜን",  "translit": "Pagumen"},
]

#: Index 0 = Sunday, matching ``jdn_to_weekday``.
WEEKDAYS = [
    {"n": 0, "amharic": "እሑድ",   "translit": "Ehud",     "english": "Sunday"},
    {"n": 1, "amharic": "ሰኞ",    "translit": "Segno",    "english": "Monday"},
    {"n": 2, "amharic": "ማክሰኞ",  "translit": "Maksegno", "english": "Tuesday"},
    {"n": 3, "amharic": "ረቡዕ",   "translit": "Rebue",    "english": "Wednesday"},
    {"n": 4, "amharic": "ሐሙስ",   "translit": "Hamus",    "english": "Thursday"},
    {"n": 5, "amharic": "ዓርብ",   "translit": "Arb",      "english": "Friday"},
    {"n": 6, "amharic": "ቅዳሜ",   "translit": "Kidame",   "english": "Saturday"},
]


class EthiopicDate(NamedTuple):
    year: int
    month: int
    day: int


class GregorianDate(NamedTuple):
    year: int
    month: int
    day: int


def is_ethiopic_leap_year(year: int) -> bool:
    """Ethiopian leap years add a 6th day to Pagumen. Year of Luke."""
    return year % 4 == 3


def is_gregorian_leap_year(year: int) -> bool:
    return (year % 4 == 0 and year % 100 != 0) or year % 400 == 0


def days_in_ethiopic_month(year: int, month: int) -> int:
    """30 for months 1-12, 5 or 6 for Pagumen."""
    if month < 1 or month > 13:
        raise ValueError(f"month must be 1-13, got {month}")
    if month == 13:
        return 6 if is_ethiopic_leap_year(year) else 5
    return 30


def is_valid_ethiopic_date(y: int, m: int, d: int) -> bool:
    if not all(isinstance(v, int) and not isinstance(v, bool) for v in (y, m, d)):
        return False
    if y < 1 or m < 1 or m > 13 or d < 1:
        return False
    return d <= days_in_ethiopic_month(y, m)


def ethiopic_to_jdn(year: int, month: int, day: int) -> int:
    if not is_valid_ethiopic_date(year, month, day):
        raise ValueError(f"invalid Ethiopian date {year}-{month}-{day}")
    return (
        JDN_EPOCH_AMETE_MIHRET + 365
        + 365 * (year - 1) + year // 4
        + 30 * month + day - 31
    )


def jdn_to_ethiopic(jdn: int) -> EthiopicDate:
    r = (jdn - JDN_EPOCH_AMETE_MIHRET) % 1461
    n = (r % 365) + 365 * (r // 1460)
    year = 4 * ((jdn - JDN_EPOCH_AMETE_MIHRET) // 1461) + r // 365 - r // 1460
    return EthiopicDate(year, n // 30 + 1, n % 30 + 1)


def gregorian_to_jdn(year: int, month: int, day: int) -> int:
    a = (14 - month) // 12
    y = year + 4800 - a
    m = month + 12 * a - 3
    return day + (153 * m + 2) // 5 + 365 * y + y // 4 - y // 100 + y // 400 - 32045


def jdn_to_gregorian(jdn: int) -> GregorianDate:
    a = jdn + 32044
    b = (4 * a + 3) // 146097
    c = a - (146097 * b) // 4
    d = (4 * c + 3) // 1461
    e = c - (1461 * d) // 4
    m = (5 * e + 2) // 153
    return GregorianDate(
        100 * b + d - 4800 + m // 10,
        m + 3 - 12 * (m // 10),
        e - (153 * m + 2) // 5 + 1,
    )


def ethiopic_to_gregorian(y: int, m: int, d: int) -> GregorianDate:
    return jdn_to_gregorian(ethiopic_to_jdn(y, m, d))


def gregorian_to_ethiopic(y: int, m: int, d: int) -> EthiopicDate:
    return jdn_to_ethiopic(gregorian_to_jdn(y, m, d))


def jdn_to_weekday(jdn: int) -> int:
    """0 = Sunday .. 6 = Saturday. JDN 0 was a Monday, hence the +1."""
    return (jdn + 1) % 7
