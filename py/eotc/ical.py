"""
iCalendar (RFC 5545) feed of an Ethiopian year's fasts and feasts.

Determinism matters here: DTSTAMP is required by the RFC but must not be "now",
or every request would produce different bytes -- breaking both HTTP caching
and the byte-parity contract with the TypeScript implementation. Each event's
DTSTAMP is derived from its own date instead.

Port of ts/src/core/ical.ts -- output is asserted byte-identical.
"""

from __future__ import annotations

import re
from typing import Any

from .bahirehasab import movable_feasts
from .bible import bible_book
from .ethiopic import MONTHS, days_in_ethiopic_month, ethiopic_to_jdn, jdn_to_gregorian
from .fasts import fast_periods
from .feasts import fixed_feasts
from .gitsawe import fixed_gitsawe_on


def _ics_date(jdn: int) -> str:
    g = jdn_to_gregorian(jdn)
    return f"{g.year:04d}{g.month:02d}{g.day:02d}"


def _esc(s: str) -> str:
    """Escape TEXT per RFC 5545 §3.3.11."""
    return (s.replace("\\", "\\\\").replace(";", "\\;")
             .replace(",", "\\,").replace("\n", "\\n"))


def _fold(line: str) -> str:
    """Fold long lines (RFC 5545 §3.1). Folds on characters, conservatively at
    60, so multi-byte Ge'ez text never splits mid-codepoint."""
    out: list[str] = []
    rest = line
    while len(rest) > 60:
        if out:
            out.append(" " + rest[:59])
            rest = rest[59:]
        else:
            out.append(rest[:60])
            rest = rest[60:]
    out.append((" " + rest) if out else rest)
    return "\r\n".join(out)


def _render(events: list[dict], cal_name: str) -> str:
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//EOTCDev//EOTCDev API 0.1.0//AM",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        _fold(f"X-WR-CALNAME:{_esc(cal_name)}"),
        "X-WR-TIMEZONE:Africa/Addis_Ababa",
    ]
    for ev in events:
        lines += [
            "BEGIN:VEVENT",
            _fold(f"UID:{ev['uid']}@eotcdev"),
            # Deterministic: derived from the event's own date, not from "now".
            f"DTSTAMP:{_ics_date(ev['startJDN'])}T000000Z",
            f"DTSTART;VALUE=DATE:{_ics_date(ev['startJDN'])}",
            f"DTEND;VALUE=DATE:{_ics_date(ev['endJDN'] + 1)}",
            _fold(f"SUMMARY:{_esc(ev['summary'])}"),
            _fold(f"DESCRIPTION:{_esc(ev['description'])}"),
            f"CATEGORIES:{ev['categories']}",
            "TRANSP:TRANSPARENT",
            "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"


def _reference_label(reading: dict[str, Any]) -> str:
    """One reading rendered for a calendar description: the Amharic book
    abbreviation with chapter and verses, falling back to the printed label when
    the citation could not be resolved to a canonical reference."""
    ref = reading.get("canonicalReference")
    if ref and ref.get("chapter"):
        book = bible_book(ref["book"])
        name = (book or {}).get("names", {}).get("amharicAbbreviation") or ref["book"]
        out = f"{name} {ref['chapter']}"
        if ref.get("verseStart"):
            out += f":{ref['verseStart']}"
            if ref.get("verseEnd") and ref["verseEnd"] != ref["verseStart"]:
                out += f"-{ref['verseEnd']}"
            elif ref.get("toEndOfChapter"):
                out += "-"
        return out
    printed = " ".join(x for x in (reading.get("sourceBook"), reading.get("sourceCitation")) if x)
    return printed.strip()


_SERVICE_LABELS = (("matins", "ዘነግህ"), ("liturgy", "ዘቅዳሴ"), ("vespers", "ዘሠርክ"))
# Matches the TypeScript /\s*[።፡]\s*$/ exactly: one trailing mark, not a run.
_TRAILING_MARK = re.compile(r"\s*[።፡]\s*$")


def _readings_description(services: dict[str, Any]) -> str:
    """The day's services as description lines, in service order."""
    lines: list[str] = []
    for name, label in _SERVICE_LABELS:
        service = services.get(name)
        if not service:
            continue
        parts: list[str] = []
        for reading in service.get("psalms", []):
            parts.append(f"ምስባክ {_reference_label(reading)}")
        for reading in service.get("epistlesAndActs", []):
            parts.append(f"ንባብ {_reference_label(reading)}")
        for reading in service.get("gospels", []):
            parts.append(f"ወንጌል {_reference_label(reading)}")
        if service.get("anaphora"):
            parts.append(f"ቅዳሴ {_TRAILING_MARK.sub('', str(service['anaphora']))}")
        if parts:
            lines.append(f"{label}: {' · '.join(parts)}")
    return "\n".join(lines)


def build_ics(year: int, type: str) -> str:
    """Build the .ics text for an Ethiopian year.
    type: fasting | feasts | readings | all."""
    events: list[dict] = []

    # The daily lectionary is its own subscription: one all-day event per day
    # carrying that day's appointed readings, not the year's fasts and feasts.
    if type == "readings":
        for month in range(1, 14):
            for day in range(1, days_in_ethiopic_month(year, month) + 1):
                fixed = fixed_gitsawe_on(month, day)
                if not fixed:
                    continue
                gitsawe_data = fixed["gitsawe"]
                description = _readings_description(gitsawe_data["services"])
                if not description:
                    continue
                jdn = ethiopic_to_jdn(year, month, day)
                commemoration = _TRAILING_MARK.sub("", gitsawe_data.get("commemoration") or "").strip()
                events.append({
                    "uid": f"readings-{year}-{month}-{day}",
                    "startJDN": jdn, "endJDN": jdn,
                    "summary": f"{MONTHS[month - 1]['amharic']} {day} · {commemoration or 'ግጻዌ'}",
                    "description": description,
                    "categories": "READING",
                })
        return _render(events, f"EOTC ግጻዌ · Daily Readings · {year} EC")

    if type != "feasts":
        for p in fast_periods(year):
            events.append({
                "uid": f"fast-{p['key']}-{year}",
                "startJDN": p["startJDN"], "endJDN": p["endJDN"],
                "summary": f"{p['amharic']} · {p['english']}",
                "description": p["description"], "categories": "FASTING",
            })
    if type != "fasting":
        for f in movable_feasts(year):
            # The three fast-opening entries are periods, not feast days.
            if f["key"] in ("nineveh", "tsome_hawaryat", "tsome_dihnet"):
                continue
            events.append({
                "uid": f"feast-{f['key']}-{year}",
                "startJDN": f["jdn"], "endJDN": f["jdn"],
                "summary": f"{f['amharic']} · {f['english']}",
                "description": f"Movable feast of the Ethiopian Orthodox Tewahedo Church (EC {year}).",
                "categories": "FEAST",
            })
        for f in fixed_feasts(year):
            events.append({
                "uid": f"feast-{f['key']}-{year}",
                "startJDN": f["jdn"], "endJDN": f["jdn"],
                "summary": f"{f['amharic']} · {f['english']}",
                "description": f"Fixed feast of the Ethiopian Orthodox Tewahedo Church (EC {year}).",
                "categories": "FEAST,MAJOR" if f["major"] else "FEAST",
            })

    events.sort(key=lambda e: (e["startJDN"], e["uid"]))
    label = {"fasting": "Fasts", "feasts": "Feasts", "all": "Fasts & Feasts"}[type]
    return _render(events, f"EOTC {label} · {year} EC")
