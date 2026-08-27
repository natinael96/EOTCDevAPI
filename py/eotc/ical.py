"""
iCalendar (RFC 5545) feed of an Ethiopian year's fasts and feasts.

Determinism matters here: DTSTAMP is required by the RFC but must not be "now",
or every request would produce different bytes -- breaking both HTTP caching
and the byte-parity contract with the TypeScript implementation. Each event's
DTSTAMP is derived from its own date instead.

Port of ts/src/core/ical.ts -- output is asserted byte-identical.
"""

from __future__ import annotations

from .bahirehasab import movable_feasts
from .ethiopic import jdn_to_gregorian
from .fasts import fast_periods
from .feasts import fixed_feasts


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


def build_ics(year: int, type: str) -> str:
    """Build the .ics text for an Ethiopian year. type: fasting | feasts | all."""
    events: list[dict] = []

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
