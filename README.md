# EOTCDev API

An open, free REST API for the **Ethiopian Orthodox Tewahedo Church calendar** —
Ethiopian↔Gregorian date conversion, fasting-day status, fasting periods, feast dates,
and a date-level bridge between the Gitsawe, Sinksar, and Bible.

Coptic developers have [`coptic.io`](https://coptic.io) and `katameros-api` to build on.
EOTC has content mega-apps but no open backend. This is that backend: **infrastructure, not another app.**

No auth. No API key. No database. The public deployment uses a generous anonymous
rate limit to prevent abuse.

```bash
curl https://eotcdev-api.workers.dev/v1/today
```

```json
{
  "gregorian": { "date": "2026-04-12" },
  "ethiopic":  { "date": "2018-08-04", "monthName": { "amharic": "ሚያዝያ" } },
  "weekday":   { "amharic": "እሑድ", "english": "Sunday" },
  "fasting":   { "isFasting": false, "reason": "Not a fasting day." },
  "feasts":    [ { "amharic": "ትንሣኤ", "english": "Easter (Resurrection)" } ]
}
```

## Two implementations, one behaviour

| | Stack | Runs on |
|---|---|---|
| **`ts/`** | TypeScript + Hono | Cloudflare Workers (free tier), Node, Deno, Bun |
| **`py/`** | Python + FastAPI | Any host; auto Swagger UI at `/docs` |

They are not "a port and a copy" — they are held identical by tests:

- **`spec/conformance.json`** — 9,154 golden vectors. Both suites assert against it.
- **`spec/responses.json`** — every route's exact HTTP response. The Python suite replays all 39 routes and asserts byte-identical JSON, **including error bodies and status codes**.

Change one implementation without the other and a build fails.

## Endpoints

| Endpoint | Description |
|---|---|
| `GET /v1/today` | Today, fully described. `?tz=Africa/Addis_Ababa` |
| `GET /v1/date/{date}` | Describe any date. `?calendar=gregorian\|ethiopian` |
| `GET /v1/convert/{date}` | Convert between calendars |
| `GET /v1/fasting/{date}` | Is it a fasting day, and **why** |
| `GET /v1/fasts/{year}` | All fasting periods of an Ethiopian year |
| `GET /v1/feasts/{year}` | All feasts. `?type=all\|movable\|fixed` |
| `GET /v1/bahire-hasab/{year}` | The full ባሕረ ሐሳብ computation |
| `GET /v1/calendar/{year}/{month}` | One Ethiopian month, day by day |
| `GET /v1/calendar/ics` | **iCalendar feed** — subscribe in Google/Apple/Outlook. `?year=&type=fasting\|feasts\|all` |
| `GET /v1/calendar/season` | Liturgical season of a date (`theme` key for UI theming) |
| `GET /v1/calendar/geez-numeral` | Arabic → Ge'ez numerals (`2018` → `፳፻፲፰`) |
| `GET /v1/gitsawe/{date}` | Gitsawe appointments + Sinksar commemorations + Bible references for a date |
| `GET /v1/readings/{date}` | Focused daily Psalms, Gospels, Epistles, Acts, and anaphora from Gitsawe |
| `POST /v1/calendar/convert/batch` | Convert up to 366 non-contiguous dates in one call |

Years are **Amete Mihret** (the ordinary Ethiopian year, ≈ Gregorian − 8). Dates are `YYYY-MM-DD`.

### Is today a fasting day?

```bash
curl /v1/fasting/2026-03-04
```
```json
{
  "isFasting": true,
  "reason": "ዓቢይ ጾም (Great Lent)",
  "periods": [ { "translit": "Abiy Tsome (Hudade)", "days": 55, "dayOfPeriod": 17 } ]
}
```

The API answers *why*, not just yes/no — which fast, how long, and how far into it you are.

### Gitsawe, Sinksar, and Bible

```bash
curl /v1/gitsawe/2026-08-28
```

The Gitsawe route links the three sources by Ethiopian month and day:

- the fixed-date **Gitsawe** appointment, separated into Matins (`ዘነግህ`),
  Liturgy (`ዘቅዳሴ`), and Vespers (`ዘሠርክ`), including alternate (`ዓዲ`) readings;
- that day's **Sinksar** commemoration summaries;
- structured annual (`ዓመታዊ`) and monthly (`ወርኀዊ በዓላት`) feast lists
  extracted from the Sinksar summary entries;
- normalized **Bible references**, while preserving the citation exactly as printed.

It intentionally reports `resolution: "fixed_candidate_only"`. The source's fixed cycle is
fully transcribed, but its movable-feast, Sunday, Athanasius occasional-reading, and Bahire
Hasab sections are not yet transcribed. The response exposes known movable-feast conflicts
instead of pretending the fixed appointment is always the final service order. Bible verse
text is not bundled: the available local editions are CC BY-NC-ND, while this API is MIT.
See [`docs/GITSAWE_DATA_MODEL.md`](docs/GITSAWE_DATA_MODEL.md) for the source model,
coverage, precedence boundary, and citation-confidence rules.

### Subscribe to the fasting calendar — no code at all

```
https://<host>/v1/calendar/ics?year=2018&type=fasting
```

Paste that URL into Google Calendar ("From URL"), Apple Calendar, or Outlook and every
fast appears as an all-day event. The feed is byte-deterministic, so it caches cleanly.

### When does Lent start this year?

```bash
curl /v1/fasts/2018
```

Returns all seven canonical fasts with start/end dates in both calendars.

## ባሕረ ሐሳብ — and how the dates are verified

Movable feasts come from **Bahire Hasab** ("the sea of thought"), the traditional computation:

```
Amete Alem → Medeb → Wenber → Abekte & Metqi → Mebaja Hamer
           → (weekday + Tewsak) → ጾመ ነነዌ → every other movable feast
```

Nineveh is the linchpin; all ten remaining movable feasts sit a fixed offset after it.
`GET /v1/bahire-hasab/{year}` exposes every intermediate value, not just the answers.

**The correctness argument.** Fasika is computed two completely independent ways —
the traditional Bahire Hasab chain above, and the Alexandrian computus (Meeus'
Julian-calendar algorithm) — and the test suite asserts they agree for **every year
from 1800 to 2200 EC**. Two methods with nothing in common but the answer, agreeing
for four centuries, is not a coincidence.

Also verified:

- 73,415 consecutive days round-trip EC→JDN→EC with no gaps or duplicates
- Weekdays cross-checked against JavaScript's own `Date`
- Nineveh always lands on a Monday; Fasika and Hosanna on a Sunday; Siklet on a Friday
- Fasika always falls within its canonical Apr 4 – May 8 window
- `Abekte + Metqi === 30` for all 401 years

## Two calendar subtleties worth knowing

**Gena is not always January 7.** The Ethiopian year 2016 began on Sept 12, 2023 (2015
was a leap year), so every date until the following Gregorian leap day is shifted by one:
Tahsas 29 fell on **January 8, 2024**. Popular sources say "always January 7"; the arithmetic
disagrees, and Lalibela in fact observes January 8. Timket shifts identically (Jan 19 → Jan 20).
This API returns the true calendar arithmetic.

**The weekly fast is not absolute.** Wednesdays and Fridays are fasting days — except during
the fifty days from Fasika to Pentecost (ሃምሳ), and except when a great feast of the Lord
(Gena, Timket) falls on one. Both exceptions are implemented and flagged in the response
as `fastFreeSeason` and `feastOverride`.

## Running it

```bash
make setup-check # verify Node 22 and Python 3.12
make install     # both toolchains from the locked/declared dependencies
make test        # regenerate fixtures, run both suites
make dev-ts      # Hono on Workers, locally
make dev-py      # FastAPI on :8000, Swagger UI at /docs
make deploy      # ship the Worker
```

The supported development versions are recorded in `.nvmrc` and `.python-version`.
The v1 product, compatibility, and content boundaries are defined in
[`docs/V1_SCOPE.md`](docs/V1_SCOPE.md).
The complete endpoint, data-model, testing, rate-limit, and deployment guide is
[`docs/API_DOCUMENTATION.md`](docs/API_DOCUMENTATION.md).

The Worker uses a dynamic token bucket (60-request burst capacity, refilling at 10
requests/second) plus Cloudflare's native 600-per-minute edge backstop. Self-hosted
Python deployments can set `EOTC_RATE_CAPACITY=60` and
`EOTC_RATE_REFILL_PER_SECOND=10`; leave capacity unset or `0` when a reverse proxy
already provides rate limiting.

## Project layout

```
spec/           conformance.json, responses.json, routes.json -- the shared contract
data/gitsawe/   Gitsawe transcriptions, source manifest, and generated quality report
ts/src/core/    ethiopic · bahirehasab · fasts · feasts · day · gitsawe
py/eotc/        matching Python modules plus the shared generated Gitsawe catalog
```

The `core` modules have **zero dependencies** in both languages. Vendor them directly
if you would rather not make a network call.

## Contributing

Corrections to the calendar data are especially welcome — feast dates, commemorations,
and regional variations in fasting practice. Please open an issue with a source.

If you change calendar behaviour, run `make spec` to regenerate the fixtures and commit
the diff. A fixture diff is a behaviour change, and reviewing it is the point.

## License

MIT
