"""
Ge'ez numeral and citation parsing, plus Ethiopic text folding for search.

The TypeScript twin is ts/src/core/citations.ts; shared response fixtures
hold the two implementations byte-identical. Keep the tables and the parsing
rules in lockstep.
"""

from __future__ import annotations

import re

_GEEZ_DIGITS = {
    "፩": 1, "፪": 2, "፫": 3, "፬": 4, "፭": 5,
    "፮": 6, "፯": 7, "፰": 8, "፱": 9, "፲": 10,
    "፳": 20, "፴": 30, "፵": 40, "፶": 50, "፷": 60,
    "፸": 70, "፹": 80, "፺": 90, "፻": 100, "፼": 10000,
}


def geez_to_integer(raw: str) -> int | None:
    total = group = run = 0
    found = False
    for char in raw or "":
        value = _GEEZ_DIGITS.get(char)
        if not value:
            continue
        found = True
        if value == 100:
            group += (run or 1) * 100
            run = 0
        elif value == 10000:
            total += (group + run or 1) * 10000
            group = run = 0
        else:
            run += value
    return total + group + run if found else None


_FOLD_PAIRS = [
    ("ሐሑሒሓሔሕሖ", "ሀሁሂሃሄህሆ"),
    ("ኀኁኂኃኄኅኆ", "ሀሁሂሃሄህሆ"),
    ("ኻኺኼኽ", "ሃሂሄህ"),
    ("ሠሡሢሣሤሥሦ", "ሰሱሲሳሴስሶ"),
    ("ዐዑዒዓዔዕዖ", "አኡኢኣኤእኦ"),
    ("ፀፁፂፃፄፅፆ", "ጸጹጺጻጼጽጾ"),
    ("1234567890", "፩፪፫፬፭፮፯፰፱0"),
]
_FOLD_MAP = {src: dst for group, target in _FOLD_PAIRS for src, dst in zip(group, target)}
_FOLD_MAP["ሃ"] = "ሀ"
_FOLD_MAP["ኣ"] = "አ"

_STRIP = set(" \t\n\r፡።፣፤፥፦፧·‧.,:;!?\"'“”‘’()[]{}-–—/\\")


def fold_ethiopic(raw: str) -> str:
    """Fold Ethiopic homophones and strip punctuation for comparison."""
    import unicodedata

    out = []
    for char in unicodedata.normalize("NFC", (raw or "")).lower():
        if char in _STRIP:
            continue
        out.append(_FOLD_MAP.get(char, char))
    return "".join(out)


_LATIN = re.compile(r"^(\d+)(?:\s*[:.]\s*(\d+)(?:\s*[-–]\s*(\d+))?)?$")
_CHAPTER_PREFIX = re.compile(r"^\s*ም(?:ዕራፍ)?\s*[·.:፡]?")
_NUMBER = re.compile(r"[፩-፼]+|\d+")
_TO_END = re.compile(r"ፍ\s*[፡፣።፥፤,.:·]?\s*ም")


def _read_number(token: str) -> int | None:
    # str.isdigit alone is true for Ge'ez numerals too (Unicode digit
    # property), so require ASCII before treating the token as Arabic digits.
    return int(token) if token.isascii() and token.isdigit() else geez_to_integer(token)


def parse_citation(raw: str) -> dict:
    """Parse the numeric part of a citation; mirrors the TypeScript grammar."""
    source = (raw or "").strip()
    none = {"chapter": None, "verseStart": None, "verseEnd": None, "toEndOfChapter": False}
    if not source:
        return dict(none)

    latin = _LATIN.match(source)
    if latin:
        return {
            "chapter": int(latin.group(1)),
            "verseStart": int(latin.group(2)) if latin.group(2) else None,
            "verseEnd": int(latin.group(3)) if latin.group(3) else None,
            "toEndOfChapter": False,
        }

    if re.search(r"[ቍቊ]", source) or "ም" in source or re.search(r"[፩-፼]", source):
        parts = re.split(r"[ቍቊ]", source)
        left = parts[0] if parts else ""
        right = " ".join(parts[1:])
        to_end = bool(_TO_END.search(source))
        chapter_match = _NUMBER.search(_CHAPTER_PREFIX.sub("", left))
        if len(parts) > 1:
            verse_values = [n for n in (_read_number(m.group(0)) for m in _NUMBER.finditer(right))
                            if n is not None and n > 0]
        else:
            all_numbers = [n for n in (_read_number(m.group(0)) for m in _NUMBER.finditer(left))
                           if n is not None and n > 0]
            verse_values = all_numbers[1:]
            if all_numbers:
                return {
                    "chapter": all_numbers[0],
                    "verseStart": verse_values[0] if verse_values else None,
                    "verseEnd": None if to_end else (verse_values[-1] if len(verse_values) > 1 else None),
                    "toEndOfChapter": to_end,
                }
            return {**none, "toEndOfChapter": to_end}
        return {
            "chapter": _read_number(chapter_match.group(0)) if chapter_match else None,
            "verseStart": verse_values[0] if verse_values else None,
            "verseEnd": None if to_end else (verse_values[-1] if len(verse_values) > 1 else None),
            "toEndOfChapter": to_end,
        }

    return dict(none)
