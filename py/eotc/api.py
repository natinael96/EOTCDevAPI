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
from .day import describe_day, eth_iso, iso
from .ethiopic import (
    MONTHS, WEEKDAYS, days_in_ethiopic_month, ethiopic_to_jdn,
    gregorian_to_jdn, is_ethiopic_leap_year, jdn_to_ethiopic, jdn_to_weekday,
)
from .fasts import fast_periods
from .feasts import fixed_feasts
from .geez import to_geez
from .ical import build_ics
from .gitsawe import fixed_gitsawe_on, gitsawe_coverage
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
        "documentation": "/v1/openapi.json",
        "note": "All Ethiopian years are Amete Mihret. Dates are YYYY-MM-DD. No auth, no rate limit, no key.",
        "endpoints": {
            "GET /v1/health": "Liveness check.",
            "GET /v1/today": "Today, fully described. ?tz=Africa/Addis_Ababa",
            "GET /v1/date/{date}": "Describe any date. ?calendar=gregorian|ethiopian",
            "GET /v1/convert/{date}": "Convert between calendars. ?calendar=gregorian|ethiopian",
            "GET /v1/fasting/{date}": "Is it a fasting day, and why. ?calendar=gregorian|ethiopian",
            "GET /v1/fasts/{year}": "All fasting periods of an Ethiopian year.",
            "GET /v1/feasts/{year}": "All feasts. ?type=all|movable|fixed",
            "GET /v1/bahire-hasab/{year}": "The full ባሕረ ሐሳብ computation.",
            "GET /v1/calendar/{year}/{month}": "One Ethiopian month, day by day.",
            "GET /v1/calendar/ics": "iCalendar feed. ?year=2018&type=fasting|feasts|all",
            "GET /v1/calendar/season": "Liturgical season of a date. ?date=&calendar=",
            "GET /v1/calendar/geez-numeral": "Arabic to Ge'ez numerals. ?number=2018",
            "GET /v1/gitsawe/{date}": "Fixed-cycle Gitsawe with Sinksar and canonical Bible links.",
            "GET /v1/readings/{date}": "Daily Psalms, Gospels, Epistles and Acts from the Gitsawe.",
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


@app.get("/v1/today", summary="Describe today")
async def today(tz: str = Query("Africa/Addis_Ababa", description="IANA timezone name")) -> dict[str, Any]:
    try:
        now = datetime.now(ZoneInfo(tz))
    except (ZoneInfoNotFoundError, ValueError, KeyError):
        raise ApiError(400, f"Unknown timezone '{tz}'.",
                       "Use an IANA name, e.g. Africa/Addis_Ababa.")
    jdn = gregorian_to_jdn(now.year, now.month, now.day)
    return {"timezone": tz, **describe_day(jdn)}


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


@app.get("/v1/readings/{date}", summary="Daily Bible readings appointed in the Gitsawe")
async def readings(date: str, calendar: str = Query("gregorian")) -> dict[str, Any]:
    jdn = parse_date(date, calendar.lower())
    described = describe_day(jdn)
    fixed = fixed_gitsawe_on(described["ethiopic"]["month"], described["ethiopic"]["day"])
    if fixed is None:
        raise ApiError(404, "No fixed-cycle Gitsawe record for this date.")
    gitsawe_data = fixed["gitsawe"]
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
    if t not in ("fasting", "feasts", "all"):
        raise ApiError(400, f"Unknown type '{t}'.", "Use 'fasting', 'feasts' or 'all'.")
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
