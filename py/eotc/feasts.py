"""
በዓላት -- fixed feasts and monthly commemorations.

Fixed feasts sit on a set Ethiopian calendar date, so their Gregorian date
drifts by a day depending on where the year falls in the leap cycle. Movable
feasts live in bahirehasab.py, anchored to Nineveh.

Port of ts/src/core/feasts.ts.
"""

from __future__ import annotations

from typing import Any

from .ethiopic import days_in_ethiopic_month, ethiopic_to_jdn, jdn_to_weekday

#: Annual feasts on a fixed Ethiopian date.
FIXED_FEASTS = [
    {"key": "enkutatash",    "month": 1,  "day": 1,  "amharic": "እንቁጣጣሽ",       "translit": "Enkutatash",       "english": "Ethiopian New Year",            "major": True},
    {"key": "meskel",        "month": 1,  "day": 17, "amharic": "መስቀል",         "translit": "Meskel",           "english": "Finding of the True Cross",     "major": True},
    {"key": "gena",          "month": 4,  "day": 29, "amharic": "ገና",           "translit": "Gena",             "english": "Nativity (Christmas)",          "major": True},
    {"key": "timket",        "month": 5,  "day": 11, "amharic": "ጥምቀት",         "translit": "Timket",           "english": "Theophany (Epiphany)",          "major": True},
    {"key": "kana_zegelila", "month": 5,  "day": 12, "amharic": "ቃና ዘገሊላ",      "translit": "Kana Zegelila",    "english": "Wedding at Cana",               "major": False},
    {"key": "kidane_mihret", "month": 6,  "day": 16, "amharic": "ኪዳነ ምሕረት",     "translit": "Kidane Mihret",    "english": "Covenant of Mercy",             "major": False},
    {"key": "giyorgis",      "month": 8,  "day": 23, "amharic": "ቅዱስ ጊዮርጊስ",    "translit": "Qidus Giyorgis",   "english": "St George",                     "major": False},
    {"key": "lideta",        "month": 9,  "day": 1,  "amharic": "ልደታ ለማርያም",    "translit": "Lideta LeMaryam",  "english": "Nativity of the Virgin Mary",   "major": False},
    {"key": "petros_pawlos", "month": 11, "day": 5,  "amharic": "ጴጥሮስ ወጳውሎስ",   "translit": "Petros WePawlos",  "english": "Sts Peter and Paul",            "major": True},
    {"key": "gabriel",       "month": 11, "day": 19, "amharic": "ቅዱስ ገብርኤል",    "translit": "Qidus Gabriel",    "english": "St Gabriel the Archangel",      "major": False},
    {"key": "buhe",          "month": 12, "day": 13, "amharic": "ቡሄ (ደብረ ታቦር)", "translit": "Buhe",             "english": "Transfiguration",               "major": True},
    {"key": "filseta",       "month": 12, "day": 16, "amharic": "ፍልሰታ ለማርያም",   "translit": "Filseta",          "english": "Assumption of the Virgin Mary", "major": True},
]

#: ወርሃዊ በዓላት -- commemorations recurring on the same day of every month.
MONTHLY_COMMEMORATIONS = [
    {"day": 1,  "amharic": "ልደታ ለማርያም",       "translit": "Lideta LeMaryam",     "english": "Nativity of the Virgin Mary"},
    {"day": 5,  "amharic": "አቦ (ገብረ መንፈስ ቅዱስ)", "translit": "Abo",               "english": "Abune Gebre Menfes Kidus"},
    {"day": 7,  "amharic": "ሥላሴ",              "translit": "Selassie",            "english": "The Holy Trinity"},
    {"day": 12, "amharic": "ቅዱስ ሚካኤል",         "translit": "Qidus Mikael",        "english": "St Michael the Archangel"},
    {"day": 14, "amharic": "አቡነ አረጋዊ",         "translit": "Abune Aregawi",       "english": "Abune Aregawi"},
    {"day": 16, "amharic": "ኪዳነ ምሕረት",         "translit": "Kidane Mihret",       "english": "Covenant of Mercy"},
    {"day": 19, "amharic": "ቅዱስ ገብርኤል",        "translit": "Qidus Gabriel",       "english": "St Gabriel the Archangel"},
    {"day": 21, "amharic": "ቅድስት ማርያም",        "translit": "Qidist Maryam",       "english": "The Virgin Mary"},
    {"day": 23, "amharic": "ቅዱስ ጊዮርጊስ",        "translit": "Qidus Giyorgis",      "english": "St George"},
    {"day": 24, "amharic": "አቡነ ተክለ ሃይማኖት",    "translit": "Abune Tekle Haymanot","english": "Abune Tekle Haymanot"},
    {"day": 27, "amharic": "መድኃኔዓለም",          "translit": "Medhane Alem",        "english": "Saviour of the World"},
    {"day": 29, "amharic": "በዓለ ወልድ",          "translit": "Be'ale Wold",         "english": "Commemoration of the Son"},
]


def fixed_feasts(year: int) -> list[dict[str, Any]]:
    """All fixed feasts of an Ethiopian year, with JDN and weekday."""
    out = []
    for f in FIXED_FEASTS:
        jdn = ethiopic_to_jdn(year, f["month"], f["day"])
        out.append({**f, "jdn": jdn,
                    "ethiopic": {"year": year, "month": f["month"], "day": f["day"]},
                    "weekday": jdn_to_weekday(jdn)})
    return sorted(out, key=lambda f: f["jdn"])


def fixed_feasts_on(year: int, month: int, day: int) -> list[dict[str, Any]]:
    return [f for f in FIXED_FEASTS if f["month"] == month and f["day"] == day]


def commemorations_on(year: int, month: int, day: int) -> list[dict[str, Any]]:
    """Monthly commemorations for a date. Pagumen is short, so it has few."""
    if day > days_in_ethiopic_month(year, month):
        return []
    return [c for c in MONTHLY_COMMEMORATIONS if c["day"] == day]
