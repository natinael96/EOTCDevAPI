"""
Is it a fasting day, and why?

Run: python examples/fasting.py [YYYY-MM-DD]
"""

import json
import os
import sys
import urllib.request

API = os.environ.get("EOTC_API", "https://eotcdev-api.natinael-96.workers.dev")
# The public deployment sits behind Cloudflare, which rejects the default
# "Python-urllib/3.x" user agent with a 403. Any descriptive User-Agent works.
HEADERS = {"User-Agent": "eotcdev-example/1.0 (+https://github.com/natinael96/EOTCDevAPI)"}


def get(path: str) -> dict:
    request = urllib.request.Request(f"{API}{path}", headers=HEADERS)
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


# A date given on the command line is Gregorian; with no argument the API's own
# "today" is used, reckoned in Addis Ababa. Deriving the date from the device
# clock would put users west of Addis on the wrong day for part of every day.
date = sys.argv[1] if len(sys.argv) > 1 else None
body = get(f"/v1/fasting/{date}") if date else get("/v1/today?tz=Africa/Addis_Ababa")

# /v1/today nests the same information under `fasting`; /v1/fasting spreads it.
fasting = body.get("fasting", body)
on = body["gregorian"]["date"] if isinstance(body.get("gregorian"), dict) else body["gregorian"]

print(f"{on}: {'ጾም · fasting' if fasting['isFasting'] else 'not a fasting day'}")
print(f"  {fasting['reason']}")

# `periods` names the fasts the day falls inside, which is what a UI should label
# the day with. A day can sit inside a period and still not be a fast: the weekly
# Wednesday and Friday fast is suspended for the fifty days after Fasika and on
# the great feasts of the Lord, and `reason` says so.
for period in fasting.get("periods", []):
    print(f"  in {period['amharic']} · {period['english']}")
