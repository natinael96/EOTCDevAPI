# EOTCDev API — Detailed Developer Documentation

## 1. Overview

EOTCDev API is an open backend for Ethiopian Orthodox Tewahedo Church calendar
applications. It combines Ethiopian calendar arithmetic, Bahire Hasab, fasting rules,
feasts, liturgical seasons, fixed-cycle Gitsawe appointments, Sinksar commemorations,
and normalized Bible references.

The project is infrastructure rather than a consumer application. It can support:

- church and parish websites;
- Ethiopian calendar applications;
- daily reading and commemoration applications;
- Telegram or messaging bots;
- fasting and feast notifications;
- calendar subscriptions;
- liturgical planning tools;
- offline or embedded calendar libraries;
- academic and historical calendar analysis.

The API does not require authentication or an API key. It has no application database
and makes no runtime request to another service. Public deployments use anonymous rate
limiting to protect the service from abuse.

## 2. Implementations

The project has two independently implemented servers with a shared contract.

| Directory | Technology | Primary purpose |
|---|---|---|
| `ts/` | TypeScript, Hono, Cloudflare Workers | Public edge deployment |
| `py/` | Python 3.12, FastAPI, Uvicorn | Self-hosting, Swagger, reference implementation |

Both implementations use pure calendar functions and the same generated Gitsawe
catalog. Shared fixtures verify that they return equivalent HTTP status codes and JSON
bodies.

The TypeScript implementation is the source used to generate HTTP response fixtures.
The Python test suite replays those requests and compares the results exactly.

## 3. Base URLs and interactive documentation

The public production deployment is the Cloudflare Worker:

```text
https://eotcdev-api.natinael-96.workers.dev
```

The local Python development server currently uses:

```text
http://localhost:8001
```

Useful local links:

| Resource | URL |
|---|---|
| API index | `http://localhost:8001/` |
| Health | `http://localhost:8001/v1/health` |
| Swagger UI | `http://localhost:8001/docs` |
| ReDoc | `http://localhost:8001/redoc` |
| OpenAPI JSON | `http://localhost:8001/v1/openapi.json` |

The default port in `make dev-py` is `8000`. Port 8001 is used when port 8000 is already
occupied. Consumers should always make the base URL configurable.

## 4. Runtime requirements and installation

Supported development versions:

- Node.js 22
- npm 10 or compatible
- Python 3.12
- GNU Make

The versions are recorded in `.nvmrc` and `.python-version`.

Verify the installed runtimes:

```bash
make setup-check
```

Install both implementations:

```bash
make install
```

This runs locked Node installation with `npm ci`, creates `py/.venv`, and installs the
Python package with its development dependencies.

Install only one implementation:

```bash
make install-ts
make install-py
```

Start the TypeScript Worker locally:

```bash
make dev-ts
```

Start Python on the default port:

```bash
make dev-py
```

Start Python on port 8001 with the dynamic limiter enabled:

```bash
cd py
EOTC_RATE_CAPACITY=60 \
EOTC_RATE_REFILL_PER_SECOND=10 \
./.venv/bin/uvicorn eotc.api:app --host 0.0.0.0 --port 8001
```

## 5. Date and calendar conventions

### Date format

Dates use:

```text
YYYY-MM-DD
```

Examples:

```text
2026-04-12   Gregorian
2018-08-04   Ethiopian
```

Single-digit month and day inputs are accepted, but responses use zero-padded dates.

### Input calendar

Endpoints accepting a date use Gregorian input by default.

Use an Ethiopian date with:

```text
?calendar=ethiopian
```

The alias `ethiopic` is also accepted internally, but API consumers should prefer
`ethiopian` for consistency.

### Ethiopian years

Years are Amete Mihret, the ordinary Ethiopian era. The current Ethiopian year is
approximately the Gregorian year minus seven or eight, depending on the date.

Year parameters accept integers from 1 through 9999. This is an arithmetic capability;
it is not a claim that every historical liturgical practice is uniform across that
entire range.

### Timezones

The default timezone for the `today` endpoint is:

```text
Africa/Addis_Ababa
```

Timezone values must be valid IANA names.

## 6. Common response behavior

Successful `/v1/*` responses receive a public cache header:

```http
Cache-Control: public, max-age=86400
```

Rate-limit responses are never cached:

```http
Cache-Control: no-store
Retry-After: <seconds>
```

CORS permits:

- any origin;
- `GET`;
- `POST`;
- `OPTIONS`.

JSON is UTF-8 and includes Amharic and Ge'ez text without ASCII escaping.

## 7. Endpoint summary

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/` | API identity and endpoint directory |
| GET | `/v1/health` | Liveness check |
| GET | `/v1/today` | Describe today in an IANA timezone |
| GET | `/v1/date/{date}` | Fully describe a date |
| GET | `/v1/convert/{date}` | Convert between calendars |
| POST | `/v1/calendar/convert/batch` | Convert up to 366 dates |
| GET | `/v1/fasting/{date}` | Fasting status and reason |
| GET | `/v1/fasts/{year}` | All fasting periods in an Ethiopian year |
| GET | `/v1/feasts/{year}` | Fixed and movable feasts |
| GET | `/v1/bahire-hasab/{year}` | Complete Bahire Hasab computation |
| GET | `/v1/calendar/{year}/{month}` | Fully described Ethiopian month |
| GET | `/v1/calendar/season` | Liturgical season for a date |
| GET | `/v1/calendar/geez-numeral` | Convert an integer to Ge'ez numerals |
| GET | `/v1/calendar/ics` | iCalendar fasting and feast feed |
| GET | `/v1/gitsawe/{date}` | Gitsawe, Sinksar, and Bible-reference detail |
| GET | `/v1/readings/{date}` | Focused daily Bible reading appointments |
| GET | `/v1/sinksar/{date}` | Sinksar annual and monthly commemoration lists |
| GET | `/v1/feasts/{year}/{key}` | One feast resolved for a year, by key, name, or alias |
| GET | `/v1/feasts/search` | Homophone-aware feast search across names and aliases |
| GET | `/v1/upcoming` | Upcoming feasts and fasts within a window |
| GET | `/v1/calendar/range` | Fully described date range, up to 366 days |
| GET | `/v1/bible/books` | Canon book metadata and verse counts |
| GET | `/v1/bible/books/{id}` | One book with per-chapter verse counts |
| GET | `/v1/bible/editions` | Bible editions registry and licensing |
| GET | `/v1/bible/parse` | Citation parsing into canonical references |
| GET | `/v1/bible/{edition}/{book}/{chapter}` | Chapter reference; text on licensed self-hosts only |
| GET | `/v1/gitsawe/seasons` | Movable-cycle reading candidates by season |
| GET | `/v1/gitsawe/monthly` | Monthly Sunday-cycle reading candidates |
| GET | `/v1/gitsawe/feasts` | Feast graph: feasts, sub-feasts, mahlet service orders |
| GET | `/v1/gitsawe/mahlets/{id}` | One mahlet service order with its chant roles |

The cycle collections are candidate reference data (`resolution: "candidates_only"`):
they are not yet applied to date resolution, so `/v1/gitsawe/{date}` remains
`fixed_candidate_only` until precedence rules are reviewed.

Full request/response documentation for these newer endpoints lives in the hosted
documentation (https://natinael96.github.io/EOTCDevAPI/docs/); the shared response
fixtures in `spec/responses.json` remain the byte-level contract for all of them.
Notes on the two least obvious:

- **Feast search** folds Ethiopic homophones before matching (ሐ/ኀ→ሀ, ሠ→ሰ, ዐ→አ,
  ፀ→ጸ, and the interchangeable first/fourth guttural orders), so ትንሳኤ finds ትንሣኤ
  and ፆም finds ጾም. Every feast also carries a curated alias list (ፋሲካ/ትንሣኤ/Easter
  are one feast).
- **Bible text mode** is a self-host opt-in: set `EOTC_BIBLE_TEXT_DIR` to a
  directory laid out like `data/bible/` on a Python deployment that holds a
  licensed edition. Without it (including on the public Worker) the chapter
  endpoint returns references with `textAvailable: false` and the license reason.

## 8. Service endpoints

### `GET /`

Returns:

- project name;
- description;
- version;
- license;
- documentation location;
- endpoint directory;
- example paths.

Example:

```bash
curl http://localhost:8001/
```

### `GET /v1/health`

The health endpoint is excluded from application rate limiting.

```bash
curl http://localhost:8001/v1/health
```

```json
{
  "status": "ok",
  "version": "0.1.0"
}
```

## 9. Date endpoints

### `GET /v1/today`

Query parameters:

| Parameter | Required | Default | Description |
|---|---:|---|---|
| `tz` | No | `Africa/Addis_Ababa` | IANA timezone name |

Example:

```bash
curl "http://localhost:8001/v1/today?tz=Africa/Addis_Ababa"
```

The response contains the timezone plus the complete date description documented below.

### `GET /v1/date/{date}`

Query parameters:

| Parameter | Required | Default | Values |
|---|---:|---|---|
| `calendar` | No | `gregorian` | `gregorian`, `ethiopian` |

Gregorian example:

```bash
curl http://localhost:8001/v1/date/2026-04-12
```

Ethiopian example:

```bash
curl "http://localhost:8001/v1/date/2018-08-04?calendar=ethiopian"
```

Representative response shape:

```json
{
  "jdn": 2461143,
  "gregorian": {
    "date": "2026-04-12",
    "year": 2026,
    "month": 4,
    "day": 12
  },
  "ethiopic": {
    "date": "2018-08-04",
    "year": 2018,
    "month": 8,
    "day": 4,
    "monthName": {
      "amharic": "ሚያዝያ",
      "translit": "Miyazya",
      "english": "Miyazya"
    }
  },
  "weekday": {
    "n": 0,
    "amharic": "እሑድ",
    "translit": "Ehud",
    "english": "Sunday"
  },
  "fasting": {},
  "feasts": []
}
```

Additional fields may be present in `gregorian`, `ethiopic`, `fasting`, and `feasts`.
Consumers should ignore unknown additive fields.

### `GET /v1/convert/{date}`

This is the smaller conversion-only form of the date endpoint.

```bash
curl http://localhost:8001/v1/convert/2026-08-27
```

It returns:

- JDN;
- Gregorian date;
- Ethiopian date;
- weekday.

It does not include fasting or feast calculations.

### `POST /v1/calendar/convert/batch`

Converts 1–366 non-contiguous dates in one request.

```bash
curl -X POST http://localhost:8001/v1/calendar/convert/batch \
  -H "Content-Type: application/json" \
  -d '{
    "calendar": "gregorian",
    "dates": ["2026-04-12", "2023-09-11", "invalid"]
  }'
```

Request body:

```json
{
  "calendar": "gregorian",
  "dates": ["2026-04-12", "2023-09-11"]
}
```

Invalid individual entries do not reject valid entries. They receive a per-item error:

```json
{
  "calendar": "gregorian",
  "count": 2,
  "results": [
    {
      "input": "2026-04-12",
      "jdn": 2461143,
      "gregorian": {},
      "ethiopic": {},
      "weekday": {}
    },
    {
      "input": "invalid",
      "error": "Could not parse date 'invalid'."
    }
  ]
}
```

The entire request fails when `dates` is missing, empty, not an array, or longer than
366 elements.

## 10. Fasting endpoints

### `GET /v1/fasting/{date}`

```bash
curl http://localhost:8001/v1/fasting/2026-03-04
```

Representative response:

```json
{
  "jdn": 2461104,
  "gregorian": "2026-03-04",
  "ethiopic": "2018-06-25",
  "weekday": {
    "n": 3,
    "amharic": "ረቡዕ",
    "translit": "Rebu",
    "english": "Wednesday"
  },
  "isFasting": true,
  "reason": "ዓቢይ ጾም (Great Lent)",
  "weeklyFast": false,
  "fastFreeSeason": false,
  "feastOverride": false,
  "periods": [
    {
      "key": "abiy_tsome",
      "dayOfPeriod": 17
    }
  ]
}
```

Important flags:

| Field | Meaning |
|---|---|
| `isFasting` | Final fasting result for the date |
| `weeklyFast` | The Wednesday/Friday rule applies |
| `fastFreeSeason` | Weekly fasting is suspended during the fifty days |
| `feastOverride` | A major feast overrides the weekly fast |
| `periods` | Named fasting periods active on the date |

### `GET /v1/fasts/{year}`

```bash
curl http://localhost:8001/v1/fasts/2018
```

Returns all seven modeled canonical fasting periods with:

- stable key;
- Amharic, transliterated, and English names;
- fixed or movable status;
- duration;
- Gregorian and Ethiopian boundaries;
- description.

It also returns the weekly-fast rule.

## 11. Feast endpoint

### `GET /v1/feasts/{year}`

Query parameters:

| Parameter | Default | Values |
|---|---|---|
| `type` | `all` | `all`, `movable`, `fixed` |

Examples:

```bash
curl "http://localhost:8001/v1/feasts/2018?type=all"
curl "http://localhost:8001/v1/feasts/2018?type=movable"
curl "http://localhost:8001/v1/feasts/2018?type=fixed"
```

Each feast includes:

- stable key;
- Amharic, transliterated, and English names;
- movable/fixed marker;
- Gregorian date;
- Ethiopian date;
- weekday;
- major-feast marker where applicable.

## 12. Bahire Hasab

### `GET /v1/bahire-hasab/{year}`

```bash
curl http://localhost:8001/v1/bahire-hasab/2018
```

The response exposes the calculation, not just the resulting dates:

```json
{
  "ethiopicYear": 2018,
  "ameteAlem": 7518,
  "evangelist": {},
  "computation": {
    "medeb": 18,
    "wenber": 17,
    "abekte": 12,
    "metqi": 18,
    "mebajaHamer": {
      "ethiopic": "2018-...",
      "monthName": {},
      "weekday": {}
    },
    "tewsakApplied": 0
  },
  "newYear": {
    "gregorian": "2025-09-11",
    "weekday": {},
    "isLeapYear": false,
    "pagumenDays": 5
  },
  "movableFeasts": []
}
```

The traditional chain is:

```text
Amete Alem
  → Medeb
  → Wenber
  → Abekte and Metqi
  → Mebaja Hamer
  → weekday and Tewsak
  → Nineveh
  → remaining movable feasts
```

The engine also computes Fasika independently with the Alexandrian computus. Tests
assert agreement from 1800 through 2200 EC.

Important invariant:

```text
Abekte + Metqi = 30
```

Nineveh is the anchor for the other movable occasions. Each returned feast includes its
offset from Nineveh.

## 13. Calendar utilities

### `GET /v1/calendar/{year}/{month}`

```bash
curl http://localhost:8001/v1/calendar/2018/8
```

Month values are 1–13. Months 1–12 contain 30 days. Pagumen contains five days, or six
in an Ethiopian leap year.

The response returns:

- Ethiopian year and month;
- localized month name;
- number of days;
- weekday on which the month starts;
- a complete date description for every day.

### `GET /v1/calendar/season`

Required query parameters:

| Parameter | Required | Default |
|---|---:|---|
| `date` | Yes | None |
| `calendar` | No | `gregorian` |

```bash
curl "http://localhost:8001/v1/calendar/season?date=2026-03-04"
```

The response includes:

- season key;
- localized names;
- UI theme key;
- Gregorian and Ethiopian boundaries;
- total days;
- day within the season.

### `GET /v1/calendar/geez-numeral`

```bash
curl "http://localhost:8001/v1/calendar/geez-numeral?number=2018"
```

```json
{
  "number": 2018,
  "geez": "፳፻፲፰"
}
```

### `GET /v1/calendar/ics`

Query parameters:

| Parameter | Required | Values |
|---|---:|---|
| `year` | Yes | Ethiopian year |
| `type` | No | `all`, `fasting`, `feasts` |

```bash
curl "http://localhost:8001/v1/calendar/ics?year=2018&type=all" \
  -o eotc-2018.ics
```

The response is `text/calendar` and is byte-deterministic. It can be subscribed to from
Google Calendar, Apple Calendar, Outlook, and compatible applications.

## 14. Gitsawe endpoint

### `GET /v1/gitsawe/{date}`

```bash
curl "http://localhost:8001/v1/gitsawe/2018-08-04?calendar=ethiopian"
```

This endpoint returns the full date-level bridge between:

- fixed-cycle Gitsawe appointments;
- Sinksar summary metadata;
- annual Sinksar feast lists;
- monthly Sinksar feast lists;
- normalized Bible references.

### Resolution status

The response currently reports:

```json
{
  "resolution": "fixed_candidate_only"
}
```

This is an important semantic restriction. Only the fixed Gitsawe cycle is currently
transcribed. The API does not claim that the fixed candidate is the final service order
when a Sunday or movable feast may take precedence.

Coverage is explicit:

```json
{
  "coverage": {
    "fixedCycle": "transcribed",
    "movableCycle": "not_transcribed",
    "sundayCycle": "not_transcribed",
    "occasionalCycle": "not_transcribed",
    "bahireHasabTables": "not_transcribed"
  }
}
```

Resolution factors include:

```json
{
  "resolutionFactors": {
    "isSunday": true,
    "movableFeasts": ["fasika"],
    "knownPrecedenceConflict": true,
    "note": "Sunday and movable Gitsawe cycles are not yet transcribed; precedence is not resolved."
  }
}
```

### Gitsawe services

The fixed appointment can contain:

| API key | Source label | Meaning |
|---|---|---|
| `matins` | `ዘነግህ` | Morning office |
| `liturgy` | `ዘቅዳሴ` | Divine Liturgy |
| `vespers` | `ዘሠርክ` | Evening office |

Each service can contain:

```json
{
  "sourceService": "ዘቅዳሴ",
  "psalms": [],
  "gospels": [],
  "epistlesAndActs": [],
  "anaphora": "..."
}
```

Readings preserve source and normalized forms:

```json
{
  "sourceField": "ወንጌል",
  "alternate": false,
  "sourceBook": "ዮሐንስ",
  "bibleBook": "JHN",
  "sourceCitation": "ም· ፲ ቍ‧ ፩ ፳፪",
  "canonicalReference": {
    "book": "JHN",
    "chapter": 10,
    "verseStart": 1,
    "verseEnd": 22,
    "toEndOfChapter": false,
    "method": "printed_citation",
    "confidence": "probable"
  }
}
```

The source citation is never overwritten by normalization.

### Alternate readings

`alternate: true` represents a source field introduced by `ዓዲ`, meaning an additional
or repeated appointment. Consumers must not discard it simply because another reading
of the same type exists.

## 15. Focused daily readings endpoint

### `GET /v1/readings/{date}`

This is the recommended endpoint for applications that need only appointed Bible
readings rather than the full Gitsawe and Sinksar response.

```bash
curl "http://localhost:8001/v1/readings/2018-12-22?calendar=ethiopian"
```

Response structure:

```json
{
  "date": {
    "gregorian": "2026-08-28",
    "ethiopic": "2018-12-22",
    "weekday": {}
  },
  "source": {
    "cycle": "fixed",
    "resolution": "fixed_candidate_only"
  },
  "resolutionFactors": {
    "isSunday": false,
    "movableFeasts": [],
    "knownPrecedenceConflict": false
  },
  "services": {
    "matins": {
      "psalms": [],
      "gospels": [],
      "epistles": [],
      "acts": [],
      "anaphora": null
    },
    "liturgy": {},
    "vespers": {}
  },
  "bible": {
    "textIncluded": false,
    "availableLocalEditions": ["gez-1980", "am-1980"],
    "license": "CC-BY-NC-ND-4.0",
    "note": "This public MIT API exposes Gitsawe citations and normalized references, not licensed Bible verse text."
  }
}
```

Unlike `/v1/gitsawe/{date}`, this endpoint excludes:

- Sinksar entries;
- commemoration narrative metadata;
- general Gitsawe source detail unrelated to reading selection.

It separates Acts from the other epistles for easier application rendering.

## 16. Sinksar annual and monthly feast lists

The Sinksar catalog contains summary entries beginning with `📌`. Two forms are exposed
as structured arrays.

### `GET /v1/sinksar/{date}`

The focused view of just those two lists for a date, without the full Gitsawe
payload. Accepts the same `?calendar=gregorian|ethiopian` parameter as
`/v1/gitsawe/{date}` and returns:

- `date` — Gregorian date, Ethiopian date, and weekday;
- `annualFeasts` — the ዓመታዊ list: source entry id, printed heading, and items;
- `monthlyFeasts` — the ወርኀዊ በዓላት list in the same shape;
- `entryCount` — how many Sinksar entries exist for the day;
- `fullTextAvailable` / `reason` — the narrative-text licensing status.

```bash
curl /v1/sinksar/2018-01-01?calendar=ethiopian
```

### Annual commemorations

Source heading example:

```text
📌 ሚያዝያ ፫ ቀን የሚከበሩ ዓመታዊ የቅዱሳን በዓላት
```

Runtime structure:

```json
{
  "annualFeasts": {
    "sourceEntryId": "8-4-4",
    "heading": "📌 ሚያዝያ ፫ ቀን የሚከበሩ ዓመታዊ የቅዱሳን በዓላት",
    "items": [
      {
        "id": "8-4-annual-1",
        "title": "ቅዱስ መርቄ ጻድቅ (ክርስቲያናዊ ነጋዴ)",
        "sourceText": "፩.ቅዱስ መርቄ ጻድቅ (ክርስቲያናዊ ነጋዴ)"
      }
    ]
  }
}
```

### Monthly commemorations

Source heading:

```text
📌 ወርኀዊ በዓላት
```

Runtime structure:

```json
{
  "monthlyFeasts": {
    "sourceEntryId": "8-4-5",
    "heading": "📌 ወርኀዊ በዓላት",
    "items": [
      {
        "id": "8-4-monthly-1",
        "title": "በዓታ ለእግዝእትነ ማርያም ድንግል ወላዲተ አምላክ",
        "sourceText": "፩.በዓታ ለእግዝእትነ ማርያም ድንግል ወላዲተ አምላክ"
      }
    ]
  }
}
```

Fields:

| Field | Meaning |
|---|---|
| `sourceEntryId` | ID of the original Sinksar summary entry |
| `heading` | Original summary heading |
| `items[].id` | Stable derived item ID |
| `items[].title` | Number prefix removed for display/search |
| `items[].sourceText` | Original numbered source line |

The compiler currently extracts 1,542 annual and 1,905 monthly feast items. A day may
legitimately lack one of the two sections; absence is represented by a `null` source ID,
`null` heading, and empty items array.

## 17. Bible reference and licensing model

### Reference layers

Every reading retains:

1. `sourceCitation` — the citation exactly as transcribed from Gitsawe;
2. `canonicalReference` — a derived machine-readable reference.

Canonical references use stable book IDs such as:

```text
MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL
1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV PSA
```

Gospel-field context is used to distinguish the Gospel of John from First John. A bare
`ዮሐንስ` inside a Gospel field resolves to `JHN`; in an epistle list it resolves to
`1JN` unless explicitly numbered otherwise.

### Confidence

Current confidence values include:

- `confirmed`;
- `probable`;
- `ambiguous`;
- `unresolved`.

Most citation-only links are `probable`. Consumers should not present probable links as
manually confirmed textual equivalence.

### “To end of chapter”

When the source indicates `ፍጻሜ ምዕራፍ`:

```json
{
  "verseStart": 18,
  "verseEnd": null,
  "toEndOfChapter": true
}
```

`verseEnd: null` prevents the starting verse from being misrepresented as the end.

### Verse text

The local Bible editions are:

- `am-1980`;
- `gez-1980`.

They are marked CC BY-NC-ND 4.0 and are intentionally gitignored. The public runtime is
MIT licensed. Consequently, the API exposes references but does not bundle Bible verse
text.

Applications that display verse text must obtain a compatible Bible edition and comply
with its attribution, noncommercial, and no-derivatives requirements.

## 18. Source coverage and precedence

The represented Gitsawe source contains several conceptual layers:

1. fixed month/day appointments;
2. movable-feast appointments;
3. Sunday appointments;
4. Athanasius and occasional-service readings;
5. printed Bahire Hasab tables.

Only layer 1 is currently transcribed into runtime data.

A complete resolver will eventually evaluate:

```text
calendar date
  ├── fixed candidate
  ├── Sunday candidate
  ├── movable-feast candidate
  ├── occasional candidate
  └── reviewed precedence rules
          ↓
     selected appointment
```

Until those sources and rules are reviewed, consumers must respect
`fixed_candidate_only` and `knownPrecedenceConflict`.

## 19. Data quality and review queue

The compiler generates:

```text
data/gitsawe/quality-report.json
```

The report currently tracks:

- Gitsawe months, days, services, and readings;
- alternate readings;
- Sinksar months, days, and entries;
- annual and monthly summary coverage;
- resolved and unresolved Bible books;
- parsed and incomplete citations;
- structured review items;
- warnings.

Current structured review queue:

| Review kind | Count | Meaning |
|---|---:|---|
| `incomplete_citation` | 23 | Printed citation lacks a complete parseable chapter/verse |
| `sinksar_day_heading_mismatch` | 16 | Catalog day and annual-summary heading disagree |
| `unresolved_bible_book` | 3 | Source label cannot be safely normalized |

These records are not automatically corrected because the current repository does not
provide conclusive evidence for the intended replacement.

Each review item contains source coordinates such as file, Ethiopian month/day, service,
source field, source label, citation, or Sinksar entry ID.

## 20. Error contract

### Bad request

Status:

```http
400 Bad Request
```

Shape:

```json
{
  "error": "bad_request",
  "message": "'2026-02-31' is not a real Gregorian date."
}
```

An optional `hint` may be included:

```json
{
  "error": "bad_request",
  "message": "Could not parse date 'bad'.",
  "hint": "Expected YYYY-MM-DD, e.g. 2026-04-12."
}
```

### Not found

```json
{
  "error": "not_found",
  "message": "No route for GET /v1/nope.",
  "hint": "See / for the endpoint list."
}
```

### Rate limited

```http
429 Too Many Requests
Retry-After: 1
Cache-Control: no-store
```

```json
{
  "error": "rate_limited",
  "message": "Too many requests. Please retry after 1 seconds.",
  "retryAfter": 1
}
```

Clients should wait for the number of seconds in `Retry-After` before retrying. Do not
retry immediately in a loop.

### Internal error

Unexpected TypeScript errors return:

```json
{
  "error": "internal",
  "message": "Unexpected error."
}
```

No stack trace is exposed to clients.

## 21. Dynamic rate limiting

### Token bucket

The application policy is a continuously refilling token bucket:

- burst capacity: 60 requests;
- refill rate: 10 requests per second;
- clients recover capacity continuously rather than at a fixed boundary;
- retry delay is calculated from the token deficit.

Cloudflare values are configured in `ts/wrangler.toml`:

```toml
[vars]
RATE_LIMIT_CAPACITY = "60"
RATE_LIMIT_REFILL_PER_SECOND = "10"
```

### Cloudflare backstop

The Worker also uses a native Cloudflare rate-limit binding:

```toml
[[ratelimits]]
name = "API_RATE_LIMITER"
namespace_id = "1001"

  [ratelimits.simple]
  limit = 600
  period = 60
```

This is a coarse, edge-local distributed backstop. The token bucket provides dynamic
burst behavior; the native binding limits sustained abuse.

### Python configuration

Environment variables:

| Variable | Default | Meaning |
|---|---:|---|
| `EOTC_RATE_CAPACITY` | `0` | Burst capacity; zero disables application limiting |
| `EOTC_RATE_REFILL_PER_SECOND` | `10` | Tokens restored each second |
| `EOTC_RATE_LIMIT` | None | Backward-compatible capacity alias |

The Python limiter is process-local. For multiple Uvicorn/Gunicorn workers or multiple
hosts, enforce the same policy with a trusted reverse proxy or shared rate-limit service.

The application does not trust a caller-supplied `X-Forwarded-For` header. Configure
trusted proxy handling at the server or proxy layer so `request.client` is authoritative.

## 22. Postman

Import:

```text
postman/EOTCDevAPI.postman_collection.json
```

The collection contains 23 requests with assertions for:

- service identity and health;
- OpenAPI;
- date conversion;
- Ethiopian input;
- batch conversion;
- fasting and feasts;
- Bahire Hasab invariants;
- calendar utilities;
- daily Bible readings;
- Gitsawe conflict reporting;
- annual Sinksar lists;
- monthly Sinksar lists;
- validation errors;
- rate-limit response structure.

Default collection variables:

| Variable | Default |
|---|---|
| `baseUrl` | `http://localhost:8001` |
| `gregorianDate` | `2026-04-12` |
| `ethiopianDate` | `2018-08-04` |
| `ethiopianYear` | `2018` |
| `ethiopianMonth` | `8` |
| `timezone` | `Africa/Addis_Ababa` |

To test the Worker, change only `baseUrl`.

## 23. Testing and generated contracts

### Complete verification

```bash
make ci
```

The complete command performs:

1. JSON parsing validation;
2. Gitsawe compilation and quality reporting;
3. conformance fixture generation;
4. HTTP fixture generation;
5. stale generated-file detection;
6. TypeScript tests;
7. Python tests;
8. TypeScript type-checking.

When intentionally changing API behavior, regenerate first:

```bash
make gitsawe
make spec
```

Then review the generated diff and run:

```bash
make test-ts
make test-py
make typecheck
make validate-json
```

The `check-generated` target compares generated artifacts against Git. It is expected to
report a diff until intentional generated changes are committed.

### Conformance coverage

The shared specification currently contains 13,623 calculation vectors, including:

- conversion;
- Ethiopian year shape;
- Bahire Hasab;
- movable feasts;
- fasting periods;
- fasting status;
- fasting-day counts;
- fixed feasts;
- commemorations;
- Ge'ez numerals;
- liturgical seasons.

### Current suites

At the time of this document:

- 40 TypeScript tests pass;
- 83 Python tests pass.

Counts will increase as features are added; a lower count should be investigated.

## 24. Data compilation

Run:

```bash
make gitsawe
```

Inputs:

```text
data/gitsawe/*.json
data/gitsawe/manifest.json
data/sinksar/*.json
```

Outputs:

```text
data/gitsawe/quality-report.json
py/eotc/gitsawe_catalog.js
```

The generated JavaScript catalog is deliberately stored inside the Python package:

- Python packages it as runtime data;
- TypeScript imports the exact same artifact;
- both implementations therefore use one normalized Gitsawe/Sinksar catalog.

The compiler:

- verifies month/day coverage;
- normalizes services and reading fields;
- preserves source citations;
- assigns canonical book IDs;
- separates source and canonical reference layers;
- extracts annual/monthly Sinksar lists;
- generates stable Sinksar item IDs;
- records incomplete or ambiguous data;
- excludes restricted full text from the runtime artifact.

## 25. Deployment

### Cloudflare Worker dry run

```bash
cd ts
npx wrangler deploy --dry-run
```

The output should list:

- `API_RATE_LIMITER`;
- `RATE_LIMIT_CAPACITY`;
- `RATE_LIMIT_REFILL_PER_SECOND`.

### Deploy

```bash
make deploy
```

Deployment requires an authenticated Cloudflare account and an appropriate unique
rate-limit namespace for that account.

### Python production hosting

The FastAPI application object is:

```text
eotc.api:app
```

Example single-process command:

```bash
cd py
./.venv/bin/uvicorn eotc.api:app --host 0.0.0.0 --port 8000
```

Production hosting should add:

- TLS termination;
- trusted proxy configuration;
- access/error logging;
- process supervision;
- availability monitoring;
- a shared or proxy rate limiter for multiple workers;
- deployment and rollback automation.

## 26. Versioning and compatibility

Current application version:

```text
0.1.0
```

Compatibility rules defined for v1:

- existing fields should not be removed or change meaning in a minor release;
- optional fields may be added;
- breaking endpoint or resolver behavior requires `/v2` or a major package version;
- generated fixtures represent the reviewable HTTP contract;
- source content and resolver rules should be versioned independently where practical.

Consumers should parse fields by name and tolerate additive fields.

## 27. Security and privacy

- There are no user accounts or API keys.
- The API does not require personal data.
- No database stores client activity.
- Rate-limit keys exist only in process/edge memory and are not API content.
- Error responses avoid internal stack traces.
- Restricted Bible and Sinksar narrative text is excluded from generated public runtime
  artifacts.
- CORS is intentionally open because the API is public infrastructure.

If private endpoints or administrative mutation are introduced later, they must not
inherit the current public CORS and authentication model without review.

## 28. Known limitations

1. Daily Gitsawe results are fixed-cycle candidates, not always final liturgical orders.
2. Movable, Sunday, occasional, and printed Bahire Hasab Gitsawe sections are not yet
   transcribed.
3. Liturgical precedence rules are not implemented.
4. Regional practice variants are not fully modeled.
5. Bible verse text is not included.
6. Three source Bible book labels remain unresolved.
7. Twenty-three printed citations remain incomplete.
8. Sixteen Sinksar annual-summary headings disagree with their catalog day index and
   require source review.
9. Gitsawe and Sinksar publication-rights status remains unverified.
10. Python rate limiting is local to one process.

The API reports incomplete coverage rather than concealing these limitations.

## 29. Contribution workflow

For a calendar behavior change:

1. cite an authoritative source;
2. update both TypeScript and Python implementations;
3. add focused tests;
4. regenerate shared fixtures;
5. review the fixture diff;
6. run both suites and type-checking;
7. update documentation.

For a Gitsawe or Sinksar correction:

1. identify source title and edition;
2. record printed and scan page numbers;
3. preserve original source text;
4. change normalized data separately;
5. add or resolve a structured review item;
6. run `make gitsawe`;
7. inspect `quality-report.json`;
8. regenerate API fixtures if runtime output changed;
9. run both test suites.

Never fill missing liturgical content by inference alone.

## 30. Related project documents

| Document | Purpose |
|---|---|
| `README.md` | Project overview and quick start |
| `ROADMAP.md` | Sequential work through stable v1 |
| `docs/V1_SCOPE.md` | Product, compatibility, and licensing boundaries |
| `docs/GITSAWE_DATA_MODEL.md` | Gitsawe source model and resolution semantics |
| `postman/EOTCDevAPI.postman_collection.json` | Import-ready API test collection |
| `data/gitsawe/quality-report.json` | Generated data-quality and review report |

