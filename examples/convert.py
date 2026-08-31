"""
Converting between the Ethiopian and Gregorian calendars.

Run: python examples/convert.py
"""

import json
import os
import urllib.request

API = os.environ.get("EOTC_API", "https://eotcdev-api.natinael-96.workers.dev")
HEADERS = {"User-Agent": "eotcdev-example/1.0 (+https://github.com/natinael96/EOTCDevAPI)"}


def get(path: str) -> dict:
    request = urllib.request.Request(f"{API}{path}", headers=HEADERS)
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def post(path: str, payload: dict) -> dict:
    request = urllib.request.Request(
        f"{API}{path}", method="POST", data=json.dumps(payload).encode(),
        headers={**HEADERS, "Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


# Gregorian in, Ethiopian out. Input is Gregorian unless told otherwise.
forward = get("/v1/convert/2026-04-12")
print(f"{forward['gregorian']['date']}  ->  {forward['ethiopic']['date']} EC "
      f"({forward['weekday']['english']})")

# Ethiopian in, Gregorian out. Ethiopian years are Amete Mihret, and the year has
# 13 months: Pagumen, month 13, has 5 days, or 6 before a leap year. Code that
# loops over months must go 1..13, not 1..12.
back = get("/v1/convert/2018-13-05?calendar=ethiopian")
print(f"{back['ethiopic']['date']} EC  ->  {back['gregorian']['date']} "
      f"({back['weekday']['english']})")

# A list of dates converts in one round trip, up to 366 per request. Individual
# bad dates come back as per-item errors rather than failing the whole batch.
batch = post("/v1/calendar/convert/batch",
             {"dates": ["2026-01-07", "2026-09-11", "2026-02-31"]})
for result in batch["results"]:
    if "error" in result:
        print(f"{result['input']}  ->  {result['error']}")
    else:
        print(f"{result['input']}  ->  {result['ethiopic']['date']} EC")
