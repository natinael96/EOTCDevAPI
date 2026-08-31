# Integrating with the EOTCDev API

Copy-paste recipes for the jobs people actually build against this API: a daily
screen, a fasting check, an upcoming-occasions strip, date conversion, and a
saint lookup.

The API needs no key, no account, and no SDK. Every recipe below is a complete
program that runs as written.

- **Base URL** — `https://eotcdev-api.natinael-96.workers.dev`
- **Reference documentation** — [API_DOCUMENTATION.md](API_DOCUMENTATION.md)

The JavaScript and Python recipes live in [`examples/`](../examples) and are
executed against a live server by `make examples` on every CI run, so what you
read here is code that is known to work. The Kotlin and Swift snippets are
illustrative: they are written against the same responses but are not run by CI.

Set `EOTC_API` to point any recipe at your own deployment:

```bash
EOTC_API=http://localhost:8001 node examples/today.js
```

## Four things worth knowing first

These are the mistakes that are easy to make against this particular API. Each
recipe below encodes them, but they are worth stating plainly.

**Never work out "today" from the device clock.** A phone in Toronto at 9pm is
already on the next Ethiopian day in Addis Ababa. If you compute the date
locally you will show the wrong commemorations to everyone west of Ethiopia for
part of every day. Call `/v1/today` and name the timezone the day should be
reckoned in, or pass an explicit date to a dated endpoint.

**The year has thirteen months.** Pagumen is month 13 and has 5 days, or 6 in
the year before a leap year. Any loop over months runs `1..13`, and any month
length comes from the API rather than a hardcoded table.

**Bible references use ordinary Hebrew numbering.** The Gitsawe prints Psalm
citations in the Ge'ez psalter's numbering, which runs a chapter behind for most
of the psalter. `canonicalReference` has already been converted, so it points at
the right passage in a normal Bible edition and will often differ by one from
the printed citation in `sourceCitation`. Link from `canonicalReference`; show
`sourceCitation` when you want to show what the book prints. When a citation
could not be resolved, `canonicalReference` is `null` rather than a wrong guess.

**Identify your client.** The public deployment sits behind Cloudflare, which
rejects the default `Python-urllib/3.x` user agent with a `403`. Send any
descriptive `User-Agent`. Browsers and Node's `fetch` set one for you.

### Caching

Dated endpoints are immutable and served with `max-age=86400`. Clock-dependent
routes — `/v1/today`, and `/v1/upcoming` without a `from` — are served with
`max-age=60, must-revalidate`. Honour those headers rather than polling; a
daily-reading screen needs one request per day, not one per minute.

## Recipe 1 · Today's screen

The flagship request. `include` is opt-in and additive: without it you get the
date and fasting status, and with it a single call fills an entire screen with
the Ethiopian date, the fasting state, who is commemorated, and the appointed
readings.

<!-- example:examples/today.js -->
```javascript
/**
 * Today's screen: the Ethiopian date, whether it is a fast, who is
 * commemorated, and the readings appointed for the day -- in one request.
 *
 * Run: node examples/today.js
 */
const API = process.env.EOTC_API ?? 'https://eotcdev-api.natinael-96.workers.dev';

// Ask the API what "today" is. Do not build this from the device clock: a phone
// in Toronto at 9pm is already on the next Ethiopian day in Addis Ababa, so a
// locally computed date shows the wrong commemorations. Name the timezone the
// day should be reckoned in and let the server resolve it.
//
// `include` is opt-in. Without it this returns just the date and fasting status;
// with it, one request fills the whole screen.
const url = `${API}/v1/today?tz=Africa/Addis_Ababa&include=readings,sinksar`;
const response = await fetch(url);
if (!response.ok) throw new Error(`EOTC API returned ${response.status}`);
const day = await response.json();

console.log(`${day.ethiopic.monthName.amharic} ${day.ethiopic.day}, ${day.ethiopic.year} ዓ.ም.`);
console.log(`${day.weekday.amharic} · ${day.gregorian.date} · ${day.ethiopic.date} EC`);
console.log(day.fasting.isFasting ? `ጾም · ${day.fasting.reason}` : 'Not a fasting day.');

// Who is commemorated. `annual` is kept once a year; `monthly` recurs on this
// day of every month, so both lists belong on the screen.
for (const [label, names] of [['ዓመታዊ · annual', day.sinksar.annual],
                              ['ወርኀዊ · monthly', day.sinksar.monthly]]) {
  if (!names.length) continue;
  console.log(`\n${label}`);
  for (const name of names) console.log(`  ${name}`);
}

/**
 * Render one reading. `canonicalReference` is the linkable form: its chapter and
 * verse numbers follow the Hebrew numbering used by ordinary Bible editions, not
 * the Ge'ez psalter numbering printed in the Gitsawe, so a Psalm reference here
 * can legitimately differ by one from the printed citation. It is null when the
 * printed citation could not be resolved, and `sourceCitation` always survives.
 */
function reference(reading) {
  const ref = reading.canonicalReference;
  if (!ref) return `${reading.sourceBook} ${reading.sourceCitation} (unresolved)`;
  const verses = ref.verseStart
    ? `:${ref.verseStart}${ref.verseEnd && ref.verseEnd !== ref.verseStart ? `-${ref.verseEnd}` : ''}`
    : '';
  return `${ref.book} ${ref.chapter}${verses}`;
}

const liturgy = day.readings.services.liturgy;
console.log('\nቅዳሴ · liturgy');
for (const psalm of liturgy.psalms) console.log(`  ምስባክ  ${reference(psalm)}`);
for (const epistle of liturgy.epistles) console.log(`  ንባብ   ${reference(epistle)}`);
for (const gospel of liturgy.gospels) console.log(`  ወንጌል  ${reference(gospel)}`);
if (liturgy.anaphora) console.log(`  ቅዳሴ   ${liturgy.anaphora}`);
```
<!-- /example -->

The same in Python, using only the standard library so there is nothing to
install. `requests` and `httpx` work identically; only the transport lines
change.

<!-- example:examples/today.py -->
```python
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
```
<!-- /example -->

Output:

```text
ነሐሴ 25, 2018 ዓ.ም.
ሰኞ · 2026-08-31 · 2018-12-25 EC
Not a fasting day.

ዓመታዊ · annual
  ቅዱስ እንድርያኖስ ሰማዕት
  "፳፬ቱ" ሰማዕታት (ማሕበሩ)
  ...

ቅዳሴ · liturgy
  ምስባክ  PSA 39:7-8
  ንባብ   EPH 6:10-19
  ወንጌል  MRK 3:7-13
  ቅዳሴ   ዘባስልዮስ ።
```

`sinksar.annual` is kept once a year; `sinksar.monthly` recurs on that day of
every month. Both belong on the screen — the monthly list is why a parish
calendar shows ቅዱስ ሚካኤል on the twelfth of each month.

## Recipe 2 · Is it a fasting day?

The most common single question, and the one with the subtlest answer: a day can
fall inside a fasting period and still not be a fast, because the weekly
Wednesday and Friday fast is suspended for the fifty days after Fasika and on
the great feasts of the Lord. Always show `reason`, which states which rule
applied, rather than deriving your own explanation from `isFasting`.

<!-- example:examples/fasting.js -->
```javascript
/**
 * Is it a fasting day, and why?
 *
 * Run: node examples/fasting.js [YYYY-MM-DD]
 */
const API = process.env.EOTC_API ?? 'https://eotcdev-api.natinael-96.workers.dev';

// A date given on the command line is Gregorian; with no argument the API's own
// "today" is used, reckoned in Addis Ababa. Deriving the date from the device
// clock would put users west of Addis on the wrong day for part of every day.
const date = process.argv[2];
const url = date
  ? `${API}/v1/fasting/${date}`
  : `${API}/v1/today?tz=Africa/Addis_Ababa`;

const response = await fetch(url);
if (!response.ok) throw new Error(`EOTC API returned ${response.status}`);
const body = await response.json();

// /v1/today nests the same information under `fasting`; /v1/fasting spreads it.
const fasting = body.fasting ?? body;
const on = body.gregorian?.date ?? body.gregorian;

console.log(`${on}: ${fasting.isFasting ? 'ጾም · fasting' : 'not a fasting day'}`);
console.log(`  ${fasting.reason}`);

// `periods` names the fasts the day falls inside, which is what a UI should
// label the day with. A day can sit inside a period and still not be a fast:
// the weekly Wednesday and Friday fast is suspended for the fifty days after
// Fasika and on the great feasts of the Lord, and `reason` says so.
for (const period of fasting.periods ?? []) {
  console.log(`  in ${period.amharic} · ${period.english}`);
}
```
<!-- /example -->

<!-- example:examples/fasting.py -->
```python
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
```
<!-- /example -->

```text
$ python examples/fasting.py 2026-04-15
2026-04-15: not a fasting day
  Not a fasting day: the weekly fast is lifted during the fifty days after Fasika.
```

## Recipe 3 · What is coming up

Feasts and fasts inside a window of at most 30 days. Each item is either a feast
day or the opening of a fasting period, carrying a `feast` or a `fast` object
accordingly; `kind` is what distinguishes them. A movable fast can open on the
same day as the feast that names it, so ጾመ ነነዌ legitimately appears twice.

<!-- example:examples/upcoming.js -->
```javascript
/**
 * What is coming up: feasts and fasts within the next 30 days.
 *
 * Run: node examples/upcoming.js
 */
const API = process.env.EOTC_API ?? 'https://eotcdev-api.natinael-96.workers.dev';

// `days` is capped at 30. Omitting `from` anchors the window to the API's own
// today, which is what a widget wants; pass `from=YYYY-MM-DD` to look ahead from
// a fixed date instead. Note the cache difference: the anchored form is
// revalidated every 60 seconds, the dated form is cacheable for a day.
const response = await fetch(`${API}/v1/upcoming?days=30&type=all`);
if (!response.ok) throw new Error(`EOTC API returned ${response.status}`);
const { from, count, items } = await response.json();

console.log(`${count} occasions in the 30 days from ${from.gregorian}\n`);
for (const item of items) {
  // Each item is either a feast day or the first day of a fasting period, and
  // carries the matching object. A movable fast can open on the same day as the
  // feast that names it, so both appear -- `kind` is what tells them apart.
  const occasion = item.feast ?? item.fast;
  const label = item.kind === 'fast_begins'
    ? `${occasion.amharic} begins (${occasion.days} days)`
    : occasion.amharic;
  const away = item.daysAway === 0 ? 'today'
    : item.daysAway === 1 ? 'tomorrow'
    : `in ${item.daysAway} days`;
  console.log(`${item.gregorian}  ${label} · ${occasion.english} — ${away}`);
}
```
<!-- /example -->

<!-- example:examples/upcoming.py -->
```python
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
```
<!-- /example -->

## Recipe 4 · Converting dates

Input is Gregorian unless `?calendar=ethiopian` says otherwise. Ethiopian years
are Amete Mihret. For a list of dates, the batch endpoint converts up to 366 in
one round trip and reports bad dates per item instead of failing the request.

<!-- example:examples/convert.js -->
```javascript
/**
 * Converting between the Ethiopian and Gregorian calendars.
 *
 * Run: node examples/convert.js
 */
const API = process.env.EOTC_API ?? 'https://eotcdev-api.natinael-96.workers.dev';

async function get(path) {
  const response = await fetch(`${API}${path}`);
  if (!response.ok) throw new Error(`EOTC API returned ${response.status} for ${path}`);
  return response.json();
}

// Gregorian in, Ethiopian out. Input is Gregorian unless told otherwise.
const forward = await get('/v1/convert/2026-04-12');
console.log(`${forward.gregorian.date}  ->  ${forward.ethiopic.date} EC (${forward.weekday.english})`);

// Ethiopian in, Gregorian out. Ethiopian years are Amete Mihret, and the year
// has 13 months: Pagumen, month 13, has 5 days, or 6 before a leap year. Code
// that loops over months must go 1..13, not 1..12.
const back = await get('/v1/convert/2018-13-05?calendar=ethiopian');
console.log(`${back.ethiopic.date} EC  ->  ${back.gregorian.date} (${back.weekday.english})`);

// A list of dates converts in one round trip, up to 366 per request. Individual
// bad dates come back as per-item errors rather than failing the whole batch.
const batch = await fetch(`${API}/v1/calendar/convert/batch`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ dates: ['2026-01-07', '2026-09-11', '2026-02-31'] }),
});
for (const result of (await batch.json()).results) {
  console.log(result.error ? `${result.input}  ->  ${result.error}`
                           : `${result.input}  ->  ${result.ethiopic.date} EC`);
}
```
<!-- /example -->

<!-- example:examples/convert.py -->
```python
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
```
<!-- /example -->

## Recipe 5 · When is a saint commemorated?

The reverse of the daily lookup. Matching is homophone-folded, so a name spelled
with any of the Ge'ez letters that share a sound still finds the entry — a
search for ሃይማኖት and one for ሓይማኖት return the same saint. Passing an Ethiopian
year resolves every match to a real date and weekday.

<!-- example:examples/saint.js -->
```javascript
/**
 * On which day is a saint commemorated?
 *
 * Run: node examples/saint.js [name]
 */
const API = process.env.EOTC_API ?? 'https://eotcdev-api.natinael-96.workers.dev';

const query = process.argv[2] ?? 'ተክለ ሃይማኖት';
const year = 2018; // Ethiopian year; resolves each match to a real date.

// Matching is homophone-folded, so a name spelled with any of the Ge'ez letters
// that share a sound still matches -- ሃይማኖት and ሓይማኖት find the same entry.
const url = `${API}/v1/sinksar/search?q=${encodeURIComponent(query)}&year=${year}`;
const response = await fetch(url);
if (!response.ok) throw new Error(`EOTC API returned ${response.status}`);
const { totalMatches, truncated, matches } = await response.json();

console.log(`${totalMatches} match(es) for "${query}"${truncated ? ' (truncated)' : ''}\n`);
for (const match of matches) {
  // A monthly commemoration recurs on this day of every month, so one saint
  // legitimately appears many times; an annual one is kept on a single day.
  const recurrence = match.kind === 'monthly' ? 'monthly' : 'annual ';
  console.log(`${recurrence}  ${match.monthName.amharic} ${match.ethiopianDay}`
    + `  ${match.date.gregorian}  ${match.title}`);
}
```
<!-- /example -->

<!-- example:examples/saint.py -->
```python
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
```
<!-- /example -->

## Recipe 6 · Calendar subscription, no code

Any calendar application that accepts a URL can subscribe to a year directly.
The feeds are byte-deterministic, so they cache cleanly and never churn.

| Feed | URL |
|---|---|
| Fasts | `…/v1/calendar/ics?year=2018&type=fasting` |
| Feasts | `…/v1/calendar/ics?year=2018&type=feasts` |
| Both | `…/v1/calendar/ics?year=2018&type=all` |
| Daily readings | `…/v1/calendar/ics?year=2018&type=readings` |

```bash
curl "https://eotcdev-api.natinael-96.workers.dev/v1/calendar/ics?year=2018&type=readings" \
  -o eotc-readings-2018.ics
```

`type=readings` is the daily lectionary: one all-day event per day of the
Ethiopian year, titled with that day's commemoration, described with the
readings appointed for matins, the liturgy, and vespers. Paste the URL into
Google Calendar ("From URL"), Apple Calendar, or Outlook.

## Mobile

The recipes above translate directly. These two are written against the same
`/v1/today` response as Recipe 1; unlike the JavaScript and Python files, they
are not executed by CI.

### Kotlin

```kotlin
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.net.HttpURLConnection
import java.net.URL

// Model only the fields you use; `ignoreUnknownKeys` keeps the app working when
// the API adds fields, which it does additively rather than by breaking shapes.
@Serializable data class Named(val amharic: String, val english: String? = null)
@Serializable data class Ethiopic(val date: String, val day: Int, val year: Int,
                                  val monthName: Named)
@Serializable data class Fasting(val isFasting: Boolean, val reason: String)
@Serializable data class Sinksar(val annual: List<String>, val monthly: List<String>)
@Serializable data class Today(val ethiopic: Ethiopic, val weekday: Named,
                               val fasting: Fasting, val sinksar: Sinksar? = null)

private val json = Json { ignoreUnknownKeys = true }

fun today(): Today {
    // Reckon the day in Addis Ababa rather than from the device clock, or a user
    // in another timezone sees the wrong commemorations for part of every day.
    val url = URL("https://eotcdev-api.natinael-96.workers.dev" +
        "/v1/today?tz=Africa/Addis_Ababa&include=sinksar")
    val connection = (url.openConnection() as HttpURLConnection).apply {
        setRequestProperty("User-Agent", "my-eotc-app/1.0")
        connectTimeout = 15_000
        readTimeout = 15_000
    }
    connection.inputStream.bufferedReader().use { reader ->
        return json.decodeFromString<Today>(reader.readText())
    }
}

fun main() {
    val day = today()
    println("${day.ethiopic.monthName.amharic} ${day.ethiopic.day}, ${day.ethiopic.year} ዓ.ም.")
    println(if (day.fasting.isFasting) "ጾም · ${day.fasting.reason}" else "Not a fasting day.")
    day.sinksar?.annual?.forEach { println("  $it") }
}
```

### Swift

```swift
import Foundation

// Model only the fields you use. Optionals cover the payloads that appear only
// when `include` asks for them.
struct Named: Decodable { let amharic: String; let english: String? }
struct Ethiopic: Decodable { let date: String; let day: Int; let year: Int
                             let monthName: Named }
struct Fasting: Decodable { let isFasting: Bool; let reason: String }
struct Sinksar: Decodable { let annual: [String]; let monthly: [String] }
struct Today: Decodable { let ethiopic: Ethiopic; let weekday: Named
                          let fasting: Fasting; let sinksar: Sinksar? }

func fetchToday() async throws -> Today {
    // Reckon the day in Addis Ababa rather than from the device clock, or a user
    // in another timezone sees the wrong commemorations for part of every day.
    var components = URLComponents(
        string: "https://eotcdev-api.natinael-96.workers.dev/v1/today")!
    components.queryItems = [
        URLQueryItem(name: "tz", value: "Africa/Addis_Ababa"),
        URLQueryItem(name: "include", value: "sinksar"),
    ]
    var request = URLRequest(url: components.url!)
    request.setValue("my-eotc-app/1.0", forHTTPHeaderField: "User-Agent")
    let (data, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
        throw URLError(.badServerResponse)
    }
    return try JSONDecoder().decode(Today.self, from: data)
}

let day = try await fetchToday()
print("\(day.ethiopic.monthName.amharic) \(day.ethiopic.day), \(day.ethiopic.year) ዓ.ም.")
print(day.fasting.isFasting ? "ጾም · \(day.fasting.reason)" : "Not a fasting day.")
day.sinksar?.annual.forEach { print("  \($0)") }
```

## Handling errors

Every failure is JSON with the same shape, so one handler covers them all.

```json
{
  "error": "bad_request",
  "message": "Unknown include 'bogus'.",
  "hint": "Use readings and/or sinksar."
}
```

| Status | Meaning | What to do |
|---|---|---|
| `400` | Malformed input | `message` says what was wrong, `hint` shows a valid form. Do not retry unchanged. |
| `404` | No record for that date or key | Expected for dates outside transcribed coverage. |
| `429` | Rate limited | Wait the seconds in `retryAfter` and the `Retry-After` header. |
| `500` | Server fault | Retry with backoff; report it if it persists. |

The full error contract is documented in
[API_DOCUMENTATION.md](API_DOCUMENTATION.md#20-error-contract).

## Running the examples yourself

```bash
node examples/today.js
python examples/today.py
```

Against a local server, and exactly as CI runs them:

```bash
make examples
```
