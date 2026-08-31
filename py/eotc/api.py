"""
EOTCDev API -- FastAPI application.

Route-for-route identical to the Hono implementation in ts/src/index.ts, and
tested for byte-level JSON parity against it. Every route is pure computation:
no database, no network, no state.
"""

from __future__ import annotations

import re
import os
import threading
import time
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from .bahirehasab import MOVABLE_FEASTS, bahire_hasab, movable_feasts
from .bible import (
    bible_book, bible_books, bible_canon_note, bible_editions,
    bible_versification, chapter_text, resolve_book,
)
from .citations import parse_citation
from .day import describe_day, eth_iso, iso
from .feast_search import feast_by_key, search_feasts
from .ethiopic import (
    MONTHS, WEEKDAYS, days_in_ethiopic_month, ethiopic_to_jdn,
    gregorian_to_jdn, is_ethiopic_leap_year, jdn_to_ethiopic, jdn_to_weekday,
)
from .fasts import fast_periods
from .feasts import fixed_feasts
from .geez import to_geez
from .ical import build_ics
from .gitsawe import fixed_gitsawe_on, gitsawe_coverage, search_sinksar
from .sinq import (
    sinq_catalog, sinq_feasts, sinq_mahlets, sinq_monthly, sinq_seasonal,
    sinq_sub_feasts,
)
from .seasons import season_of

VERSION = "0.1.0"

app = FastAPI(
    title="EOTCDev API",
    version=VERSION,
    description=(
        "Open calendar data for the Ethiopian Orthodox Tewahedo Church: date "
        "conversion, fasting days, fasting periods, and feasts. No auth, no key."
    ),
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/v1/openapi.json",
)

app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["*"]
)


class _TokenBucketLimiter:
    """Continuously refilling limiter for self-hosted FastAPI deployments.

    Multi-worker deployments should enforce the same contract at their reverse
    proxy or use a shared limiter. The Cloudflare implementation uses its native
    edge binding instead of this process-local state.
    """

    def __init__(self) -> None:
        self._buckets: dict[str, tuple[float, float]] = {}
        self._lock = threading.Lock()

    def take(self, key: str, capacity: int, refill_per_second: float,
             now: float | None = None) -> tuple[bool, int]:
        current = time.monotonic() if now is None else now
        if capacity <= 0 or refill_per_second <= 0:
            return True, 0
        with self._lock:
            tokens, updated = self._buckets.get(key, (float(capacity), current))
            tokens = min(float(capacity), tokens + max(0.0, current - updated) * refill_per_second)
            if tokens < 1:
                retry_after = max(1, int((1 - tokens) / refill_per_second + 0.999999))
                self._buckets[key] = (tokens, current)
                return False, retry_after
            self._buckets[key] = (tokens - 1, current)
            if len(self._buckets) > 10_000:
                stale_before = current - (capacity / refill_per_second) * 2
                self._buckets = {k: v for k, v in self._buckets.items() if v[1] >= stale_before}
            return True, 0


_rate_limiter = _TokenBucketLimiter()


@app.middleware("http")
async def _rate_limit(request: Request, call_next):
    if request.method == "OPTIONS" or request.url.path == "/v1/health" or not request.url.path.startswith("/v1/"):
        return await call_next(request)
    try:
        capacity = int(os.getenv("EOTC_RATE_CAPACITY", os.getenv("EOTC_RATE_LIMIT", "0")))
        refill = float(os.getenv("EOTC_RATE_REFILL_PER_SECOND", "10"))
    except ValueError:
        capacity, refill = 0, 10
    if capacity > 0 and refill > 0:
        # Uvicorn's trusted proxy handling should establish request.client before
        # the application runs. Do not trust a caller-supplied forwarding header.
        client = request.client.host if request.client else "anonymous"
        allowed, retry_after = _rate_limiter.take(client, capacity, refill)
        if not allowed:
            return JSONResponse(
                {"error": "rate_limited",
                 "message": f"Too many requests. Please retry after {retry_after} seconds.",
                 "retryAfter": retry_after},
                status_code=429,
                headers={"retry-after": str(retry_after), "cache-control": "no-store"},
            )
    return await call_next(request)


class ApiError(Exception):
    def __init__(self, status: int, message: str, hint: str | None = None):
        self.status, self.message, self.hint = status, message, hint


@app.exception_handler(ApiError)
async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
    body: dict[str, Any] = {
        "error": "bad_request" if exc.status == 400 else "not_found",
        "message": exc.message,
    }
    if exc.hint:
        body["hint"] = exc.hint
    return JSONResponse(body, status_code=exc.status)


@app.exception_handler(404)
async def _not_found(request: Request, _exc) -> JSONResponse:
    return JSONResponse(
        {"error": "not_found",
         "message": f"No route for {request.method} {request.url.path}.",
         "hint": "See / for the endpoint list."},
        status_code=404,
    )


@app.middleware("http")
async def _cache_headers(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/v1/") and response.status_code == 200:
        if request.url.path == "/v1/health":
            response.headers["cache-control"] = "no-store"
        elif request.url.path == "/v1/today" or (
                request.url.path == "/v1/upcoming" and not request.query_params.get("from")):
            response.headers["cache-control"] = "public, max-age=60, must-revalidate"
        else:
            response.headers["cache-control"] = "public, max-age=86400"
    return response


DATE_RE = re.compile(r"^(\d{1,4})-(\d{1,2})-(\d{1,2})$")


def parse_date(raw: str, calendar: str) -> int:
    """Parse ``YYYY-MM-DD`` in either calendar into a JDN."""
    m = DATE_RE.match(raw.strip())
    if not m:
        raise ApiError(400, f"Could not parse date '{raw}'.",
                       "Expected YYYY-MM-DD, e.g. 2026-04-12.")
    y, mo, d = int(m[1]), int(m[2]), int(m[3])

    if calendar in ("ethiopian", "ethiopic"):
        if not 1 <= mo <= 13:
            raise ApiError(400, f"Ethiopian month must be 1-13, got {mo}.")
        dim = days_in_ethiopic_month(y, mo)
        if not 1 <= d <= dim:
            raise ApiError(
                400, f"{MONTHS[mo - 1]['translit']} {y} has {dim} days, got day {d}.",
                "Pagumen has 5 days, or 6 in a leap year." if mo == 13 else None)
        return ethiopic_to_jdn(y, mo, d)

    if calendar != "gregorian":
        raise ApiError(400, f"Unknown calendar '{calendar}'.", "Use 'gregorian' or 'ethiopian'.")
    if not (1 <= mo <= 12 and 1 <= d <= 31):
        raise ApiError(400, f"Invalid Gregorian date '{raw}'.")
    jdn = gregorian_to_jdn(y, mo, d)
    # Reject dates like 2026-02-31 that survive the arithmetic but do not exist.
    if iso(jdn) != f"{y:04d}-{mo:02d}-{d:02d}":
        raise ApiError(400, f"'{raw}' is not a real Gregorian date.")
    return jdn


def parse_year(raw: str) -> int:
    try:
        y = int(raw)
    except (TypeError, ValueError):
        y = -1
    if not 1 <= y <= 9999 or not re.fullmatch(r"\d+", str(raw).strip()):
        raise ApiError(400, f"Ethiopian year must be an integer 1-9999, got '{raw}'.",
                       "The current Ethiopian year is roughly the Gregorian year minus 8.")
    return y


def _wd(n: int) -> dict[str, Any]:
    return {"n": n, **WEEKDAYS[n]}


def _eth_iso_of(jdn: int) -> str:
    e = jdn_to_ethiopic(jdn)
    return eth_iso(e.year, e.month, e.day)


@app.get("/", include_in_schema=False)
async def index() -> dict[str, Any]:
    return {
        "name": "EOTCDev API",
        "description": (
            "Open calendar data for the Ethiopian Orthodox Tewahedo Church: date "
            "conversion, fasting days, fasting periods, and feasts."
        ),
        "version": VERSION,
        "license": "MIT",
        "documentation": "https://natinael96.github.io/EOTCDevAPI/docs/",
        "website": "https://natinael96.github.io/EOTCDevAPI/",
        "openapi": "/v1/openapi.json",
        "note": "All Ethiopian years are Amete Mihret. Dates are YYYY-MM-DD. No auth, no API key; a generous anonymous rate limit applies.",
        "endpoints": {
            "GET /v1/health": "Liveness check.",
            "GET /v1/today": "Today, fully described. ?tz=Africa/Addis_Ababa&include=readings,sinksar",
            "GET /v1/date/{date}": "Describe any date. ?calendar=gregorian|ethiopian",
            "GET /v1/convert/{date}": "Convert between calendars. ?calendar=gregorian|ethiopian",
            "GET /v1/fasting/{date}": "Is it a fasting day, and why. ?calendar=gregorian|ethiopian",
            "GET /v1/fasts/{year}": "All fasting periods of an Ethiopian year.",
            "GET /v1/feasts/{year}": "All feasts. ?type=all|movable|fixed",
            "GET /v1/feasts/{year}/{key}": "One feast resolved for a year, by key, name, or alias.",
            "GET /v1/feasts/search": "Find a feast by any of its names, homophone-aware. ?q=&year=",
            "GET /v1/upcoming": "Upcoming feasts and fasts. ?days=30&type=all|feasts|fasts",
            "GET /v1/bahire-hasab/{year}": "The full ባሕረ ሐሳብ computation.",
            "GET /v1/calendar/{year}/{month}": "One Ethiopian month, day by day.",
            "GET /v1/calendar/range": "Describe a date range, up to 366 days. ?start=&end=&calendar=",
            "GET /v1/calendar/ics": "iCalendar feed. ?year=2018&type=fasting|feasts|readings|all",
            "GET /v1/calendar/season": "Liturgical season of a date. ?date=&calendar=",
            "GET /v1/calendar/geez-numeral": "Arabic to Ge'ez numerals. ?number=2018",
            "GET /v1/gitsawe/{date}": "Fixed-cycle Gitsawe with Sinksar and canonical Bible links.",
            "GET /v1/gitsawe/seasons": "Movable-cycle reading candidates by season. ?season=abiyTsom",
            "GET /v1/gitsawe/monthly": "Monthly Sunday-cycle reading candidates.",
            "GET /v1/gitsawe/feasts": "The feast graph: feasts, sub-feasts, and mahlet service orders.",
            "GET /v1/gitsawe/mahlets/{id}": "One mahlet service order with its chant roles.",
            "GET /v1/sinksar/{date}": "The day's Sinksar annual and monthly commemoration lists.",
            "GET /v1/readings/{date}": "Daily Psalms, Gospels, Epistles and Acts from the Gitsawe.",
            "GET /v1/bible/books": "The canon: book metadata and verse counts. ?testament=&section=",
            "GET /v1/bible/books/{id}": "One book with per-chapter verse counts.",
            "GET /v1/bible/editions": "Bible editions registry and licensing.",
            "GET /v1/bible/parse": "Parse a citation into a canonical reference. ?q=",
            "GET /v1/bible/{edition}/{book}/{chapter}": "Chapter reference; verse text only on licensed self-hosts.",
            "POST /v1/calendar/convert/batch": "Convert many dates at once. body: {dates:[], calendar?}",
        },
        "examples": [
            "/v1/today", "/v1/date/2026-04-12", "/v1/fasting/2026-03-04",
            "/v1/fasts/2018", "/v1/bahire-hasab/2018", "/v1/calendar/2018/1",
        ],
    }


@app.get("/v1/health", summary="Liveness check")
async def health() -> dict[str, str]:
    return {"status": "ok", "version": VERSION}


def _reading_services(gitsawe_data: dict[str, Any]) -> dict[str, Any]:
    """Shared by /v1/readings/{date} and /v1/today?include=readings, so the two
    can never describe the same day's services differently."""
    services: dict[str, Any] = {}
    for name, service in gitsawe_data["services"].items():
        epistles_and_acts = service.get("epistlesAndActs", [])
        services[name] = {
            "psalms": service.get("psalms", []),
            "gospels": service.get("gospels", []),
            "epistles": [r for r in epistles_and_acts if r.get("bibleBook") != "ACT"],
            "acts": [r for r in epistles_and_acts if r.get("bibleBook") == "ACT"],
            "anaphora": service.get("anaphora"),
        }
    return services


# Optional payloads for /v1/today. A daily companion wants the readings and the
# day's commemorations on one screen; everyone else wants the small response
# they already have, so these are opt-in and the default is unchanged.
_TODAY_INCLUDES = ["readings", "sinksar"]


def _parse_include(raw: str | None) -> set[str]:
    wanted = [part.strip().lower() for part in (raw or "").split(",") if part.strip()]
    for name in wanted:
        if name not in _TODAY_INCLUDES:
            raise ApiError(400, f"Unknown include '{name}'.",
                           f"Use {' and/or '.join(_TODAY_INCLUDES)}.")
    return set(wanted)


@app.get("/v1/today", summary="Describe today")
async def today(tz: str = Query("Africa/Addis_Ababa", description="IANA timezone name"),
                include: str = Query(None, description="readings and/or sinksar")) -> dict[str, Any]:
    try:
        now = datetime.now(ZoneInfo(tz))
    except (ZoneInfoNotFoundError, ValueError, KeyError):
        raise ApiError(400, f"Unknown timezone '{tz}'.",
                       "Use an IANA name, e.g. Africa/Addis_Ababa.")
    wanted = _parse_include(include)
    jdn = gregorian_to_jdn(now.year, now.month, now.day)
    described = describe_day(jdn)
    body: dict[str, Any] = {"timezone": tz, **described}
    if wanted:
        fixed = fixed_gitsawe_on(described["ethiopic"]["month"], described["ethiopic"]["day"])
        if "readings" in wanted:
            gitsawe_data = fixed["gitsawe"] if fixed else None
            body["readings"] = {
                "source": {"cycle": gitsawe_data["cycle"], "resolution": "fixed_candidate_only"},
                "services": _reading_services(gitsawe_data),
            } if gitsawe_data else None
        # Who is commemorated today: the annual and monthly names, as displayed.
        # The full entries, with their headings and source text, stay on
        # /v1/sinksar/{date}; this is the reading list, not the archive record.
        if "sinksar" in wanted:
            sinksar_data = fixed["sinksar"] if fixed else None
            body["sinksar"] = {
                "annual": [i["title"] for i in sinksar_data["annualFeasts"]["items"]],
                "monthly": [i["title"] for i in sinksar_data["monthlyFeasts"]["items"]],
                "entryCount": sinksar_data["entryCount"],
            } if sinksar_data else None
    return body


@app.get("/v1/date/{date}", summary="Describe any date")
async def date_endpoint(date: str, calendar: str = Query("gregorian")) -> dict[str, Any]:
    return describe_day(parse_date(date, calendar.lower()))


@app.get("/v1/convert/{date}", summary="Convert between calendars")
async def convert(date: str, calendar: str = Query("gregorian")) -> dict[str, Any]:
    d = describe_day(parse_date(date, calendar.lower()))
    return {k: d[k] for k in ("jdn", "gregorian", "ethiopic", "weekday")}


@app.get("/v1/fasting/{date}", summary="Fasting status for a date")
async def fasting(date: str, calendar: str = Query("gregorian")) -> dict[str, Any]:
    d = describe_day(parse_date(date, calendar.lower()))
    return {"jdn": d["jdn"], "gregorian": d["gregorian"]["date"],
            "ethiopic": d["ethiopic"]["date"], "weekday": d["weekday"], **d["fasting"]}


_CYCLE_NOTE = ("Candidate reference data: these cycles are not yet applied to date resolution; "
               "/v1/gitsawe/{date} remains fixed_candidate_only until precedence rules are reviewed.")


@app.get("/v1/gitsawe/seasons", summary="Movable-cycle Gitsawe candidates by season")
async def gitsawe_seasons(season: str = Query(None)) -> dict[str, Any]:
    all_entries = sinq_seasonal()
    if season and not any(entry["season"] == season for entry in all_entries):
        known = ", ".join(sorted({entry["season"] for entry in all_entries}))
        raise ApiError(400, f"Unknown season '{season}'.", f"Known seasons: {known}.")
    seasons = [entry for entry in all_entries if entry["season"] == season] if season else all_entries
    return {
        "resolution": "candidates_only",
        "note": _CYCLE_NOTE,
        "textPolicy": sinq_catalog()["source"]["textPolicy"],
        "count": len(seasons),
        "seasons": seasons,
    }


@app.get("/v1/gitsawe/monthly", summary="Monthly Sunday-cycle Gitsawe candidates")
async def gitsawe_monthly() -> dict[str, Any]:
    return {
        "resolution": "candidates_only",
        "note": _CYCLE_NOTE,
        "textPolicy": sinq_catalog()["source"]["textPolicy"],
        "count": len(sinq_monthly()),
        "entries": sinq_monthly(),
    }


@app.get("/v1/gitsawe/feasts", summary="The Gitsawe feast graph")
async def gitsawe_feasts() -> dict[str, Any]:
    mahlets_by_sub_feast: dict[str, list[dict[str, Any]]] = {}
    for mahlet in sinq_mahlets():
        mahlets_by_sub_feast.setdefault(mahlet["subFeast"], []).append(
            {"id": mahlet["id"], "title": mahlet["title"], "chantCount": len(mahlet["chants"])})
    feasts = [{
        "id": feast["id"],
        "name": feast["name"],
        "amharicName": feast["amharicName"],
        "month": feast["month"],
        "monthNum": feast["monthNum"],
        "day": feast["day"],
        "dateKey": feast["dateKey"],
        "movable": feast["movable"],
        "provenance": feast["provenance"],
        "subFeasts": [{
            "id": sub["id"],
            "name": sub["name"],
            "amharicName": sub["amharicName"],
            "mahlets": mahlets_by_sub_feast.get(sub["id"], []),
        } for sub in sinq_sub_feasts() if sub["feast"] == feast["id"]],
    } for feast in sinq_feasts()]
    return {
        "resolution": "candidates_only",
        "note": _CYCLE_NOTE,
        "count": {
            "feasts": len(feasts),
            "subFeasts": len(sinq_sub_feasts()),
            "mahlets": len(sinq_mahlets()),
        },
        "feasts": feasts,
    }


@app.get("/v1/gitsawe/mahlets/{id}", summary="One mahlet service order")
async def gitsawe_mahlet(id: str) -> dict[str, Any]:
    wanted = id if id.startswith("mahlet:") else f"mahlet:{id}"
    mahlet = next((entry for entry in sinq_mahlets() if entry["id"] == wanted), None)
    if mahlet is None:
        raise ApiError(404, f"Unknown mahlet '{id}'.", "See /v1/gitsawe/feasts for the list.")
    sub_feast = next(sub for sub in sinq_sub_feasts() if sub["id"] == mahlet["subFeast"])
    feast = next(entry for entry in sinq_feasts() if entry["id"] == sub_feast["feast"])
    return {
        "id": mahlet["id"],
        "title": mahlet["title"],
        "subFeast": {"id": sub_feast["id"], "name": sub_feast["name"],
                     "amharicName": sub_feast["amharicName"]},
        "feast": {"id": feast["id"], "name": feast["name"], "amharicName": feast["amharicName"]},
        "chantSource": mahlet["chantSource"],
        "chants": mahlet["chants"],
        "chantTextAvailable": mahlet["chantTextAvailable"],
        "textPolicy": sinq_catalog()["source"]["textPolicy"],
    }


@app.get("/v1/gitsawe/{date}", summary="Fixed-cycle Gitsawe appointments for a date")
async def gitsawe(date: str, calendar: str = Query("gregorian")) -> dict[str, Any]:
    jdn = parse_date(date, calendar.lower())
    described = describe_day(jdn)
    fixed = fixed_gitsawe_on(described["ethiopic"]["month"], described["ethiopic"]["day"])
    if fixed is None:
        raise ApiError(404, "No fixed-cycle Gitsawe record for this date.")
    movable_feasts = [feast["key"] for feast in described["feasts"] if feast["movable"]]
    is_sunday = described["weekday"]["n"] == 0
    return {
        "date": {
            "gregorian": described["gregorian"]["date"],
            "ethiopic": described["ethiopic"]["date"],
            "weekday": described["weekday"],
        },
        "coverage": gitsawe_coverage(),
        "resolution": "fixed_candidate_only",
        "resolutionFactors": {
            "isSunday": is_sunday,
            "movableFeasts": movable_feasts,
            "knownPrecedenceConflict": is_sunday or bool(movable_feasts),
            "note": "Sunday and movable Gitsawe cycles are not yet transcribed; precedence is not resolved.",
        },
        "gitsawe": fixed["gitsawe"],
        "sinksar": fixed["sinksar"],
        "bible": {
            "textIncluded": False,
            "localEditions": ["gez-1980", "am-1980"],
            "license": "CC-BY-NC-ND-4.0",
            "note": "Canonical references identify passages; Bible verse text is not bundled with the MIT API.",
        },
    }


# Registered before /v1/sinksar/{date} so 'search' is not read as a date.
_SINKSAR_SEARCH_LIMIT = 200


@app.get("/v1/sinksar/search", summary="Find which day a commemoration is kept")
async def sinksar_search(q: str = Query(None), year: str = Query(None)) -> dict[str, Any]:
    if not q or not q.strip():
        raise ApiError(400, "Missing query parameter 'q'.",
                       "Example: /v1/sinksar/search?q=ሚካኤል")
    resolved_year = parse_year(year) if year else None
    all_matches = search_sinksar(q)
    matches: list[dict[str, Any]] = []
    for match in all_matches[:_SINKSAR_SEARCH_LIMIT]:
        entry: dict[str, Any] = {
            "title": match["title"],
            "kind": match["kind"],
            "ethiopianMonth": match["ethiopianMonth"],
            "ethiopianDay": match["ethiopianDay"],
            "monthName": MONTHS[match["ethiopianMonth"] - 1],
            "confidence": match["confidence"],
        }
        if resolved_year:
            jdn = ethiopic_to_jdn(resolved_year, match["ethiopianMonth"], match["ethiopianDay"])
            entry["date"] = {
                "ethiopic": eth_iso(resolved_year, match["ethiopianMonth"], match["ethiopianDay"]),
                "gregorian": iso(jdn),
                "weekday": _wd(jdn_to_weekday(jdn)),
            }
        matches.append(entry)
    return {
        "query": q,
        "ethiopicYear": resolved_year,
        "count": len(matches),
        "totalMatches": len(all_matches),
        "truncated": len(all_matches) > len(matches),
        "note": "Monthly commemorations recur, so one name can match the same day in several months.",
        "matches": matches,
    }


@app.get("/v1/sinksar/{date}", summary="Sinksar annual and monthly commemorations for a date")
async def sinksar(date: str, calendar: str = Query("gregorian")) -> dict[str, Any]:
    jdn = parse_date(date, calendar.lower())
    described = describe_day(jdn)
    fixed = fixed_gitsawe_on(described["ethiopic"]["month"], described["ethiopic"]["day"])
    sinksar_data = fixed["sinksar"] if fixed else None
    if sinksar_data is None:
        raise ApiError(404, "No Sinksar record for this date.")
    return {
        "date": {
            "gregorian": described["gregorian"]["date"],
            "ethiopic": described["ethiopic"]["date"],
            "weekday": described["weekday"],
        },
        "annualFeasts": sinksar_data["annualFeasts"],
        "monthlyFeasts": sinksar_data["monthlyFeasts"],
        "entryCount": sinksar_data["entryCount"],
        "fullTextAvailable": sinksar_data["fullTextAvailable"],
        "reason": sinksar_data["reason"],
    }


@app.get("/v1/readings/{date}", summary="Daily Bible readings appointed in the Gitsawe")
async def readings(date: str, calendar: str = Query("gregorian")) -> dict[str, Any]:
    jdn = parse_date(date, calendar.lower())
    described = describe_day(jdn)
    fixed = fixed_gitsawe_on(described["ethiopic"]["month"], described["ethiopic"]["day"])
    if fixed is None:
        raise ApiError(404, "No fixed-cycle Gitsawe record for this date.")
    gitsawe_data = fixed["gitsawe"]
    services = _reading_services(gitsawe_data)
    movable_keys = [f["key"] for f in described["feasts"] if f["movable"]]
    is_sunday = described["weekday"]["n"] == 0
    return {
        "date": {
            "gregorian": described["gregorian"]["date"],
            "ethiopic": described["ethiopic"]["date"],
            "weekday": described["weekday"],
        },
        "source": {"cycle": gitsawe_data["cycle"], "resolution": "fixed_candidate_only"},
        "resolutionFactors": {
            "isSunday": is_sunday,
            "movableFeasts": movable_keys,
            "knownPrecedenceConflict": is_sunday or bool(movable_keys),
        },
        "services": services,
        "bible": {
            "textIncluded": False,
            "availableLocalEditions": ["gez-1980", "am-1980"],
            "license": "CC-BY-NC-ND-4.0",
            "note": "This public MIT API exposes Gitsawe citations and normalized references, not licensed Bible verse text.",
        },
    }


@app.get("/v1/fasts/{year}", summary="Fasting periods of an Ethiopian year")
async def fasts(year: str) -> dict[str, Any]:
    y = parse_year(year)
    return {
        "ethiopicYear": y,
        "periods": [
            {"key": p["key"], "amharic": p["amharic"], "translit": p["translit"],
             "english": p["english"], "movable": p["movable"], "days": p["days"],
             "start": {"gregorian": iso(p["startJDN"]), "ethiopic": _eth_iso_of(p["startJDN"])},
             "end": {"gregorian": iso(p["endJDN"]), "ethiopic": _eth_iso_of(p["endJDN"])},
             "description": p["description"]}
            for p in fast_periods(y)
        ],
        "weeklyFast": {
            "amharic": "ጾመ ድህነት", "translit": "Tsome Dihnet", "english": "Fast of Salvation",
            "rule": ("Every Wednesday and Friday, suspended during the fifty days from Fasika "
                     "to Pentecost, and on the great feasts of the Lord (Gena, Timket)."),
        },
    }


@app.get("/v1/feasts/search", summary="Find a feast by any of its names")
async def feasts_search(q: str = Query(None), year: str = Query(None),
                        calendar: str = Query("gregorian")) -> dict[str, Any]:
    if not q or not q.strip():
        raise ApiError(400, "Missing query parameter 'q'.", "Example: /v1/feasts/search?q=ትንሳኤ")
    y = parse_year(year) if year else None
    matches = []
    for match in search_feasts(q):
        definition = match["definition"]
        entry = {
            "key": definition["key"],
            "amharic": definition["amharic"],
            "translit": definition["translit"],
            "english": definition["english"],
            "movable": definition["movable"],
            "aliases": definition["aliases"],
            "matchedOn": match["matchedOn"],
            "matchedValue": match["matchedValue"],
            "confidence": match["confidence"],
        }
        if y is not None:
            entry["date"] = _resolve_feast_for_year(definition, y)
        matches.append(entry)
    return {"query": q, "normalized": True, "ethiopicYear": y,
            "count": len(matches), "matches": matches}


def _resolve_feast_for_year(definition: dict[str, Any], year: int) -> dict[str, Any]:
    movable = next((f for f in movable_feasts(year) if f["key"] == definition["key"]), None)
    if movable is not None:
        jdn = movable["jdn"]
    else:
        jdn = next(f for f in fixed_feasts(year) if f["key"] == definition["key"])["jdn"]
    return {"gregorian": iso(jdn), "ethiopic": _eth_iso_of(jdn),
            "weekday": _wd(jdn_to_weekday(jdn))}


@app.get("/v1/feasts/{year}", summary="Feasts of an Ethiopian year")
async def feasts(year: str, type: str = Query("all", pattern="^(all|movable|fixed)$")) -> dict[str, Any]:
    y = parse_year(year)
    t = type.lower()
    if t not in ("all", "movable", "fixed"):
        raise ApiError(400, f"Unknown type '{t}'.", "Use 'all', 'movable' or 'fixed'.")
    movable = [
        {"key": f["key"], "amharic": f["amharic"], "translit": f["translit"],
         "english": f["english"], "movable": True, "gregorian": iso(f["jdn"]),
         "ethiopic": _eth_iso_of(f["jdn"]), "weekday": _wd(f["weekday"])}
        for f in movable_feasts(y)
    ]
    fixed = [
        {"key": f["key"], "amharic": f["amharic"], "translit": f["translit"],
         "english": f["english"], "movable": False, "major": f["major"],
         "gregorian": iso(f["jdn"]), "ethiopic": _eth_iso_of(f["jdn"]),
         "weekday": _wd(f["weekday"])}
        for f in fixed_feasts(y)
    ]
    if t == "movable":
        out = movable
    elif t == "fixed":
        out = fixed
    else:
        out = sorted(movable + fixed, key=lambda f: f["gregorian"])
    return {"ethiopicYear": y, "type": t, "count": len(out), "feasts": out}


@app.get("/v1/feasts/{year}/{key}", summary="One feast resolved for a year")
async def feast_lookup(year: str, key: str) -> dict[str, Any]:
    y = parse_year(year)
    definition = feast_by_key(key)
    if definition is None:
        raise ApiError(404, f"Unknown feast '{key}'.",
                       "Use a feast key, name, or alias; /v1/feasts/search?q= finds them.")
    return {
        "ethiopicYear": y,
        "key": definition["key"],
        "amharic": definition["amharic"],
        "translit": definition["translit"],
        "english": definition["english"],
        "movable": definition["movable"],
        "major": definition["major"],
        "aliases": definition["aliases"],
        "date": _resolve_feast_for_year(definition, y),
    }


@app.get("/v1/upcoming", summary="Upcoming feasts and fasts")
async def upcoming(days: str = Query("30"), type: str = Query("all"),
                   tz: str = Query("Africa/Addis_Ababa"),
                   date_from: str = Query(None, alias="from"),
                   calendar: str = Query("gregorian")) -> dict[str, Any]:
    try:
        n_days = int(days)
    except ValueError:
        n_days = -1
    if n_days < 1 or n_days > 30:
        raise ApiError(400, f"'days' must be an integer from 1 to 30, got '{days}'.")
    t = type.lower()
    if t not in ("all", "feasts", "fasts"):
        raise ApiError(400, f"Unknown type '{t}'.", "Use 'all', 'feasts' or 'fasts'.")
    if date_from:
        start_jdn = parse_date(date_from, calendar.lower())
    else:
        try:
            now = datetime.now(ZoneInfo(tz))
        except (ZoneInfoNotFoundError, ValueError, KeyError):
            raise ApiError(400, f"Unknown timezone '{tz}'.",
                           "Use an IANA name, e.g. Africa/Addis_Ababa.")
        start_jdn = gregorian_to_jdn(now.year, now.month, now.day)
    end_jdn = start_jdn + n_days - 1

    items: list[dict[str, Any]] = []
    if t != "fasts":
        for offset in range(n_days):
            jdn = start_jdn + offset
            for feast in describe_day(jdn)["feasts"]:
                items.append({
                    "daysAway": offset, "kind": "feast",
                    "gregorian": iso(jdn), "ethiopic": _eth_iso_of(jdn),
                    "feast": feast,
                })
    if t != "feasts":
        start_year = jdn_to_ethiopic(start_jdn).year
        end_year = jdn_to_ethiopic(end_jdn).year
        for y in range(start_year, end_year + 2):
            for period in fast_periods(y):
                for kind, jdn in (("fast_begins", period["startJDN"]), ("fast_ends", period["endJDN"])):
                    if jdn < start_jdn or jdn > end_jdn:
                        continue
                    items.append({
                        "daysAway": jdn - start_jdn, "kind": kind,
                        "gregorian": iso(jdn), "ethiopic": _eth_iso_of(jdn),
                        "fast": {
                            "key": period["key"], "amharic": period["amharic"],
                            "translit": period["translit"], "english": period["english"],
                            "movable": period["movable"], "days": period["days"],
                        },
                    })
    items.sort(key=lambda item: (
        item["daysAway"], item["kind"],
        str((item.get("feast") or item.get("fast") or {}).get("key", "")),
    ))
    return {
        "from": {"gregorian": iso(start_jdn), "ethiopic": _eth_iso_of(start_jdn)},
        "days": n_days, "type": t, "count": len(items), "items": items,
    }


@app.get("/v1/calendar/range", summary="Describe a date range")
async def calendar_range(start: str = Query(None), end: str = Query(None),
                         calendar: str = Query("gregorian")) -> dict[str, Any]:
    if not start or not end:
        raise ApiError(400, "Both 'start' and 'end' query parameters are required.",
                       "Example: /v1/calendar/range?start=2026-04-01&end=2026-04-30")
    start_jdn = parse_date(start, calendar.lower())
    end_jdn = parse_date(end, calendar.lower())
    if end_jdn < start_jdn:
        raise ApiError(400, "'end' must not be before 'start'.")
    count = end_jdn - start_jdn + 1
    if count > 366:
        raise ApiError(400, f"Range covers {count} days; the maximum is 366.",
                       "Use /v1/calendar/{year}/{month} per month, or split the range.")
    return {
        "start": {"gregorian": iso(start_jdn), "ethiopic": _eth_iso_of(start_jdn)},
        "end": {"gregorian": iso(end_jdn), "ethiopic": _eth_iso_of(end_jdn)},
        "count": count,
        "days": [describe_day(start_jdn + i) for i in range(count)],
    }


def _book_summary(book: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": book["id"], "order": book["order"], "slug": book["slug"],
        "testament": book["testament"], "section": book["section"],
        "names": book["names"], "chapters": book["chapters"],
    }


@app.get("/v1/bible/books", summary="The canon: book metadata and verse counts")
async def bible_books_endpoint(testament: str = Query(None), section: str = Query(None)) -> dict[str, Any]:
    t = testament.lower() if testament else None
    s = section.lower() if section else None
    if t and t not in ("old", "new"):
        raise ApiError(400, f"Unknown testament '{t}'.", "Use 'old' or 'new'.")
    books = [
        _book_summary(book) for book in bible_books()
        if (not t or book["testament"] == t)
        and (not s or (book["section"] or "").lower() == s)
    ]
    return {
        "versification": bible_versification(), "canonNote": bible_canon_note(),
        "count": len(books), "books": books,
    }


@app.get("/v1/bible/books/{id}", summary="One book with per-chapter verse counts")
async def bible_book_endpoint(id: str) -> dict[str, Any]:
    book = bible_book(id)
    if book is None:
        resolved = resolve_book(id)
        book = resolved["book"] if resolved else None
    if book is None:
        raise ApiError(404, f"Unknown book '{id}'.", "See /v1/bible/books for the canon.")
    return {
        **_book_summary(book),
        "versification": bible_versification(),
        "verseCounts": book["verseCounts"],
        "textEditions": book["textEditions"],
    }


@app.get("/v1/bible/editions", summary="Bible editions registry and licensing")
async def bible_editions_endpoint() -> dict[str, Any]:
    return {"count": len(bible_editions()), "editions": bible_editions()}


@app.get("/v1/bible/parse", summary="Parse a citation into a canonical reference")
async def bible_parse(q: str = Query(None)) -> dict[str, Any]:
    if not q or not q.strip():
        raise ApiError(400, "Missing query parameter 'q'.",
                       "Example: /v1/bible/parse?q=ዮሐንስ ም· ፫ ቍ ፲፮")
    tokens = q.strip().split()
    match = None
    citation = None
    # Shortest book part first, so citation numerals never get swallowed into
    # the book label; numbered book names still win because their bare prefix
    # is ambiguous until the numeral is included.
    for i in range(1, len(tokens)):
        candidate = resolve_book(" ".join(tokens[:i]))
        if not candidate:
            continue
        parsed = parse_citation(" ".join(tokens[i:]))
        if parsed["chapter"]:
            match, citation = candidate, parsed
            break
        if match is None:
            match, citation = candidate, parsed
    if match is None:
        whole = resolve_book(q)
        if whole:
            match = whole
            citation = {"chapter": None, "verseStart": None, "verseEnd": None, "toEndOfChapter": False}
    book = match["book"] if match else None
    if book and citation and citation["chapter"]:
        within = (1 <= citation["chapter"] <= book["chapters"]
                  and (citation["verseStart"] is None
                       or 1 <= citation["verseStart"] <= book["verseCounts"][citation["chapter"] - 1]))
    else:
        within = None
    return {
        "input": q,
        "resolved": book is not None,
        "book": ({"id": book["id"], "names": book["names"],
                  "matchedOn": match["matchedOn"], "confidence": match["confidence"]}
                 if book else None),
        "chapter": citation["chapter"] if citation else None,
        "verseStart": citation["verseStart"] if citation else None,
        "verseEnd": citation["verseEnd"] if citation else None,
        "toEndOfChapter": citation["toEndOfChapter"] if citation else False,
        "withinBounds": within,
        "versification": bible_versification(),
    }


@app.get("/v1/bible/{edition}/{book}/{chapter}", summary="Chapter reference and, on licensed self-hosts, verse text")
async def bible_chapter(edition: str, book: str, chapter: str) -> dict[str, Any]:
    edition_entry = next((e for e in bible_editions() if e["id"] == edition), None)
    if edition_entry is None:
        known = ", ".join(e["id"] for e in bible_editions())
        raise ApiError(400, f"Unknown edition '{edition}'.", f"Known editions: {known}.")
    resolved_book = bible_book(book)
    if resolved_book is None:
        resolved = resolve_book(book)
        resolved_book = resolved["book"] if resolved else None
    if resolved_book is None:
        raise ApiError(404, f"Unknown book '{book}'.", "See /v1/bible/books for the canon.")
    try:
        n_chapter = int(chapter)
    except ValueError:
        n_chapter = 0
    if n_chapter < 1:
        raise ApiError(400, f"Chapter must be a positive integer, got '{chapter}'.")
    if n_chapter > resolved_book["chapters"]:
        raise ApiError(404, f"{resolved_book['id']} has {resolved_book['chapters']} chapters; "
                            f"there is no chapter {n_chapter}.")
    verses = chapter_text(edition, resolved_book, n_chapter)
    return {
        "edition": {"id": edition_entry["id"], "title": edition_entry["title"],
                    "license": edition_entry["license"], "source": edition_entry["source"]},
        "book": {"id": resolved_book["id"], "names": resolved_book["names"]},
        "chapter": n_chapter,
        "verseCount": resolved_book["verseCounts"][n_chapter - 1],
        "verses": verses,
        "textAvailable": verses is not None,
        "reason": (None if verses is not None
                   else "Verse text is not bundled with the public MIT runtime; the edition is CC BY-NC-ND."),
        "selfHost": (None if verses is not None
                     else "Self-hosted Python deployments with the edition present locally can serve text; see the documentation."),
    }


@app.get("/v1/bahire-hasab/{year}", summary="The full ባሕረ ሐሳብ computation")
async def bahire_hasab_endpoint(year: str) -> dict[str, Any]:
    y = parse_year(year)
    b = bahire_hasab(y)
    mh = b["mebajaHamer"]
    return {
        "ethiopicYear": y,
        "ameteAlem": b["ameteAlem"],
        "evangelist": b["evangelist"],
        "computation": {
            "medeb": b["medeb"], "wenber": b["wenber"], "abekte": b["abekte"], "metqi": b["metqi"],
            "mebajaHamer": {
                "ethiopic": eth_iso(mh["year"], mh["month"], mh["day"]),
                "monthName": MONTHS[mh["month"] - 1],
                "weekday": _wd(mh["weekday"]),
            },
            "tewsakApplied": b["ninevehJDN"] - ethiopic_to_jdn(mh["year"], mh["month"] + 4, mh["day"]),
        },
        "newYear": {
            "gregorian": iso(ethiopic_to_jdn(y, 1, 1)),
            "weekday": _wd(b["meskeremOneWeekday"]),
            "isLeapYear": is_ethiopic_leap_year(y),
            "pagumenDays": days_in_ethiopic_month(y, 13),
        },
        "movableFeasts": [
            {"key": f["key"], "amharic": f["amharic"], "translit": f["translit"],
             "english": f["english"], "daysFromNineveh": f["offset"],
             "gregorian": iso(b["ninevehJDN"] + f["offset"]),
             "ethiopic": _eth_iso_of(b["ninevehJDN"] + f["offset"]),
             "weekday": _wd(jdn_to_weekday(b["ninevehJDN"] + f["offset"]))}
            for f in MOVABLE_FEASTS
        ],
    }



# --- calendar utilities (registered before /v1/calendar/{year}/{month}) -----

@app.get("/v1/calendar/ics", summary="iCalendar feed of a year's fasts and feasts")
async def calendar_ics(year: str = Query(""), type: str = Query("all")) -> Response:
    y = parse_year(year)
    t = type.lower()
    if t not in ("fasting", "feasts", "all", "readings"):
        raise ApiError(400, f"Unknown type '{t}'.", "Use 'fasting', 'feasts', 'readings' or 'all'.")
    return Response(
        content=build_ics(y, t),
        media_type="text/calendar; charset=utf-8",
        headers={"content-disposition": f'attachment; filename="eotc-{t}-{y}.ics"'},
    )


@app.get("/v1/calendar/season", summary="Liturgical season of a date")
async def calendar_season(date: str = Query(""), calendar: str = Query("gregorian")) -> dict[str, Any]:
    if not date:
        raise ApiError(400, "Missing 'date' query parameter.", "e.g. ?date=2026-03-04")
    jdn = parse_date(date, calendar.lower())
    s = season_of(jdn)
    return {
        "date": {"gregorian": iso(jdn), "ethiopic": _eth_iso_of(jdn)},
        "season": {
            "key": s["key"], "amharic": s["amharic"], "translit": s["translit"],
            "english": s["english"], "theme": s["theme"],
            "start": {"gregorian": iso(s["startJDN"]), "ethiopic": _eth_iso_of(s["startJDN"])},
            "end": {"gregorian": iso(s["endJDN"]), "ethiopic": _eth_iso_of(s["endJDN"])},
            "days": s["endJDN"] - s["startJDN"] + 1,
            "dayOfSeason": jdn - s["startJDN"] + 1,
        },
    }


@app.get("/v1/calendar/geez-numeral", summary="Arabic to Ge'ez numerals")
async def geez_numeral(number: str = Query("")) -> dict[str, Any]:
    if not number:
        raise ApiError(400, "Missing 'number' query parameter.", "e.g. ?number=2018")
    try:
        n = int(number)
    except ValueError:
        raise ApiError(400, f"Expected an integer, got '{number}'.")
    try:
        return {"number": n, "geez": to_geez(n)}
    except ValueError as e:
        raise ApiError(400, str(e))


class BatchBody(BaseModel):
    # Deliberately loose: validation lives in the handler so the error shape
    # and status (400, not FastAPI's 422) match the Hono implementation.
    dates: Any = None
    calendar: Any = "gregorian"


BATCH_LIMIT = 366


@app.post("/v1/calendar/convert/batch", summary="Convert many dates at once")
async def convert_batch(body: BatchBody) -> dict[str, Any]:
    if not isinstance(body.dates, list) or not body.dates:
        raise ApiError(400, "Body must have a non-empty 'dates' array.")
    if len(body.dates) > BATCH_LIMIT:
        raise ApiError(400, f"At most {BATCH_LIMIT} dates per request, got {len(body.dates)}.")
    calendar = body.calendar.lower() if isinstance(body.calendar, str) else "gregorian"
    results: list[dict[str, Any]] = []
    for raw in body.dates:
        if not isinstance(raw, str):
            results.append({"input": raw, "error": "Each date must be a string."})
            continue
        try:
            d = describe_day(parse_date(raw, calendar))
            results.append({"input": raw, "jdn": d["jdn"], "gregorian": d["gregorian"],
                            "ethiopic": d["ethiopic"], "weekday": d["weekday"]})
        except ApiError as e:
            results.append({"input": raw, "error": e.message})
    return {"calendar": calendar, "count": len(results), "results": results}


@app.get("/v1/calendar/{year}/{month}", summary="One Ethiopian month, day by day")
async def calendar(year: str, month: str) -> dict[str, Any]:
    y = parse_year(year)
    try:
        m = int(month)
    except (TypeError, ValueError):
        m = -1
    if not 1 <= m <= 13:
        raise ApiError(400, f"Ethiopian month must be 1-13, got '{month}'.",
                       "Month 13 is Pagumen, the short month.")
    n = days_in_ethiopic_month(y, m)
    days = [describe_day(ethiopic_to_jdn(y, m, i + 1)) for i in range(n)]
    return {"ethiopicYear": y, "month": m, "monthName": MONTHS[m - 1], "days": n,
            "startsOn": _wd(days[0]["weekday"]["n"]), "calendar": days}
