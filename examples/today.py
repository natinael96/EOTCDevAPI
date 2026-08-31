"""
Today's screen: the Ethiopian date, whether it is a fast, who is commemorated,
and the readings appointed for the day -- in one request.

Run: python examples/today.py

Uses only the standard library so it runs anywhere. `requests` or `httpx` work
the same way; only the two transport lines change.
"""

import json
import os
import urllib.request

API = os.environ.get("EOTC_API", "https://eotcdev-api.natinael-96.workers.dev")


# Identify your application. The public deployment sits behind Cloudflare, which
# rejects the default "Python-urllib/3.x" user agent with a 403; any descriptive
# User-Agent is accepted, and it also lets the maintainers see what is calling.
HEADERS = {"User-Agent": "eotcdev-example/1.0 (+https://github.com/natinael96/EOTCDevAPI)"}


def get(path: str) -> dict:
    request = urllib.request.Request(f"{API}{path}", headers=HEADERS)
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


# Ask the API what "today" is. Do not build this from the device clock: a phone
# in Toronto at 9pm is already on the next Ethiopian day in Addis Ababa, so a
# locally computed date shows the wrong commemorations. Name the timezone the
# day should be reckoned in and let the server resolve it.
#
# `include` is opt-in. Without it this returns just the date and fasting status;
# with it, one request fills the whole screen.
day = get("/v1/today?tz=Africa/Addis_Ababa&include=readings,sinksar")

print(f"{day['ethiopic']['monthName']['amharic']} {day['ethiopic']['day']}, "
      f"{day['ethiopic']['year']} ዓ.ም.")
print(f"{day['weekday']['amharic']} · {day['gregorian']['date']} · {day['ethiopic']['date']} EC")
print(f"ጾም · {day['fasting']['reason']}" if day["fasting"]["isFasting"]
      else "Not a fasting day.")

# Who is commemorated. `annual` is kept once a year; `monthly` recurs on this day
# of every month, so both lists belong on the screen.
for label, names in (("ዓመታዊ · annual", day["sinksar"]["annual"]),
                     ("ወርኀዊ · monthly", day["sinksar"]["monthly"])):
    if not names:
        continue
    print(f"\n{label}")
    for name in names:
        print(f"  {name}")


def reference(reading: dict) -> str:
    """Render one reading.

    `canonicalReference` is the linkable form: its chapter and verse numbers
    follow the Hebrew numbering used by ordinary Bible editions, not the Ge'ez
    psalter numbering printed in the Gitsawe, so a Psalm reference here can
    legitimately differ by one from the printed citation. It is None when the
    printed citation could not be resolved, and `sourceCitation` always survives.
    """
    ref = reading.get("canonicalReference")
    if not ref:
        return f"{reading['sourceBook']} {reading['sourceCitation']} (unresolved)"
    verses = ""
    if ref["verseStart"]:
        verses = f":{ref['verseStart']}"
        if ref["verseEnd"] and ref["verseEnd"] != ref["verseStart"]:
            verses += f"-{ref['verseEnd']}"
    return f"{ref['book']} {ref['chapter']}{verses}"


liturgy = day["readings"]["services"]["liturgy"]
print("\nቅዳሴ · liturgy")
for psalm in liturgy["psalms"]:
    print(f"  ምስባክ  {reference(psalm)}")
for epistle in liturgy["epistles"]:
    print(f"  ንባብ   {reference(epistle)}")
for gospel in liturgy["gospels"]:
    print(f"  ወንጌል  {reference(gospel)}")
if liturgy["anaphora"]:
    print(f"  ቅዳሴ   {liturgy['anaphora']}")
