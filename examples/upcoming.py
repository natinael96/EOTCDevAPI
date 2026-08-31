"""
What is coming up: feasts and fasts within the next 30 days.

Run: python examples/upcoming.py
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


# `days` is capped at 30. Omitting `from` anchors the window to the API's own
# today, which is what a widget wants; pass `from=YYYY-MM-DD` to look ahead from
# a fixed date instead. Note the cache difference: the anchored form is
# revalidated every 60 seconds, the dated form is cacheable for a day.
body = get("/v1/upcoming?days=30&type=all")

print(f"{body['count']} occasions in the 30 days from {body['from']['gregorian']}\n")
for item in body["items"]:
    # Each item is either a feast day or the first day of a fasting period, and
    # carries the matching object. A movable fast can open on the same day as the
    # feast that names it, so both appear -- `kind` is what tells them apart.
    occasion = item.get("feast") or item["fast"]
    if item["kind"] == "fast_begins":
        label = f"{occasion['amharic']} begins ({occasion['days']} days)"
    else:
        label = occasion["amharic"]
    if item["daysAway"] == 0:
        away = "today"
    elif item["daysAway"] == 1:
        away = "tomorrow"
    else:
        away = f"in {item['daysAway']} days"
    print(f"{item['gregorian']}  {label} · {occasion['english']} — {away}")
