"""
On which day is a saint commemorated?

Run: python examples/saint.py [name]
"""

import json
import os
import sys
import urllib.parse
import urllib.request

API = os.environ.get("EOTC_API", "https://eotcdev-api.natinael-96.workers.dev")
HEADERS = {"User-Agent": "eotcdev-example/1.0 (+https://github.com/natinael96/EOTCDevAPI)"}


def get(path: str) -> dict:
    request = urllib.request.Request(f"{API}{path}", headers=HEADERS)
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


query = sys.argv[1] if len(sys.argv) > 1 else "ተክለ ሃይማኖት"
year = 2018  # Ethiopian year; resolves each match to a real date.

# Matching is homophone-folded, so a name spelled with any of the Ge'ez letters
# that share a sound still matches -- ሃይማኖት and ሓይማኖት find the same entry.
body = get(f"/v1/sinksar/search?q={urllib.parse.quote(query)}&year={year}")

truncated = " (truncated)" if body["truncated"] else ""
print(f"{body['totalMatches']} match(es) for \"{query}\"{truncated}\n")
for match in body["matches"]:
    # A monthly commemoration recurs on this day of every month, so one saint
    # legitimately appears many times; an annual one is kept on a single day.
    recurrence = "monthly" if match["kind"] == "monthly" else "annual "
    print(f"{recurrence}  {match['monthName']['amharic']} {match['ethiopianDay']}"
          f"  {match['date']['gregorian']}  {match['title']}")
