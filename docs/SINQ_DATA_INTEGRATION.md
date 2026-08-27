# Sinq Data Structure and EOTCDevAPI Integration Plan

Status: analysis complete; implementation contract proposed  
Reviewed: 2026-08-28  
Source inspected: local `---sinq` application repository

## 1. Decision

EOTCDevAPI should adopt Sinq's separation of liturgical data into independent
layers, but it must not replace the API's existing fixed-cycle Gitsawe data.

The combined model will be:

1. `fixed` — the reading appointed for an Ethiopian calendar date;
2. `seasonal` — a movable reading located through Bahire Hasab;
3. `monthly` — a Sunday or date-range reading within an Ethiopian month;
4. `feast` — stable feast metadata for fixed and movable celebrations;
5. `subFeast` — a stable child occasion linked to a feast;
6. `mahlet` — an ordered chant service linked to a sub-feast;
7. `sinksar` — commemorations and annual/monthly feast summaries;
8. `resolution` — the API's explicit, reviewable decision about which
   candidates apply and which one takes precedence.

Sinq is a useful structural source. It is not, by structure alone, a final
liturgical authority.

## 2. What Was Verified

### 2.1 Sinksar is already shared

The Sinq and EOTCDevAPI Sinksar manifest and all month files, `1.json` through
`13.json`, are byte-for-byte identical. No Sinksar import or conversion is
needed. The API already exposes the necessary annual and monthly summary lists.

### 2.2 Gitsawe sources are complementary

| Property | EOTCDevAPI fixed source | Sinq source |
|---|---:|---:|
| Daily Ethiopian positions | 366 | 301 |
| Daily key | month file + day | `DD-MM` |
| Fixed services | Matins, Liturgy, Vespers | Negh, Kidassie |
| Epistle/Acts records | 1,104 | fixed named slots |
| Seasonal records | not yet imported | 43 |
| Monthly records | not yet imported | 9 |
| Feast records | Sinksar summaries | 21 stable feast records |
| Sub-feast records | none | 40 |
| Mahlet records | none | 37 |

The EOTCDevAPI fixed source is a scan transcription of
`መጽሐፈ ግጻዌ ወመዝሙር ከነምልክቱ` and preserves printed citations, incipits,
scan pages, and transcription uncertainty. Sinq states that its normalized
Gitsawe was extracted from the open `gitsawe` npm dataset. These are different
source identities and must remain distinguishable.

### 2.3 Sinq's clean structural choices

Sinq keeps independently matched collections in separate files:

```text
gitsawe/
├── daily-gitsawe.json
├── seasonal-gitsawe.json
├── monthly-gitsawe.json
├── feasts.json
├── sub-feasts.json
├── mahlets.json
├── months.json
└── packages.json
```

Its daily entries use an Ethiopian `DD-MM` key and split services into `negh`
and `kidassie`. Each service has fixed semantic slots:

- `msbak` — psalm/prokeimenon;
- `wengel` — Gospel;
- `firstDeacon` — first deacon reading;
- `secondDeacon` — second deacon reading;
- `secondKahn` — priest/Acts reading;
- `kidassie` — appointed anaphora or chant names.

A reading contains multilingual incipit text and a structured verse reference:

```json
{
  "text": {
    "geez": "...",
    "amharic": "...",
    "english": "..."
  },
  "verse": {
    "bookTitle": "የማርቆስ ወንጌል",
    "chapter": 12,
    "start": 38,
    "end": 43,
    "endNote": null,
    "endText": null
  }
}
```

This is easier for API clients than inferring the epistle order from a generic
array. The EOTCDevAPI normalized output should therefore expose stable slots
while continuing to retain original source fields.

## 3. Canonical API Model

### 3.1 Source record

Every imported record must identify its origin and transformation:

```json
{
  "source": {
    "dataset": "sinq-gitsawe",
    "sourceEdition": "gitsawe-npm",
    "sourceKey": "01-neneweTsom",
    "importVersion": 1,
    "transformation": "lossless-normalization"
  }
}
```

Existing scan-transcribed data must use a separate `dataset` and
`sourceEdition`. Data from the two sources must never be merged into one field
without per-value provenance.

### 3.2 Reading slot

Use stable English identifiers in public JSON and preserve the source label:

| API slot | Sinq field | Existing source meaning |
|---|---|---|
| `psalm` | `msbak` | `ምስባክ` |
| `gospel` | `wengel` | `ወንጌል` |
| `paulineEpistle` | `firstDeacon` | first applicable Pauline reading |
| `catholicEpistle` | `secondDeacon` | first applicable Catholic Epistle |
| `acts` | `secondKahn` | Acts/priest reading |
| `anaphora` | `kidassie` | `ቅዳሴ` name, not a Bible passage |

The importer must classify by canonical Bible book, not only by list position.
If a source slot disagrees with the canonical book family, the original slot is
preserved and the record is flagged for review.

### 3.3 Liturgical candidate

```json
{
  "id": "seasonal:neneweTsom:1",
  "cycle": "seasonal",
  "title": "ዘነነዌ ሰኑይ",
  "match": {
    "season": "neneweTsom",
    "week": 1,
    "part": null
  },
  "services": {},
  "source": {},
  "review": {
    "status": "unreviewed",
    "issues": []
  }
}
```

Allowed `cycle` values are `fixed`, `seasonal`, `monthly`, `feast`, and
`occasional`.

### 3.4 Feast relationships

Use explicit identifiers rather than matching display text:

```text
Feast.key 1 ─── * SubFeast.feast
SubFeast.key 1 ─── * Mahlet.subFeast
```

Fixed feasts may contain `ethiopianMonth`, `ethiopianDay`, and `dateKey`.
Movable feasts must be linked to a Bahire Hasab rule and must not invent a fixed
date.

## 4. Date Resolution Contract

For a requested date, the API should perform these steps without discarding any
candidate:

1. Convert the input into Gregorian and Ethiopian dates.
2. Load the complete fixed-cycle entry by Ethiopian month and day.
3. Compute named Bahire Hasab events and season-relative position.
4. Match all seasonal candidates by canonical season, week, weekday, and part.
5. Match monthly candidates by Ethiopian month, inclusive day range, cross-month
   range, weekday, or ordinal Sunday.
6. Match fixed and movable feasts.
7. Attach Sinksar annual and monthly summaries.
8. Return every match under `candidates`.
9. Apply only reviewed precedence rules to produce `selected`.
10. If precedence is not reviewed, return `selected: null` and an explicit
    resolution status rather than guessing.

Proposed status values:

- `resolved_reviewed` — a reviewed rule selected the service;
- `fixed_candidate_only` — only the fixed reading is currently supported;
- `multiple_candidates_unresolved` — candidates exist but precedence is not
  approved;
- `no_candidate` — no source supplied a reading;
- `source_conflict` — sources disagree on a material reference or assignment.

## 5. Important Rules Not to Copy Blindly

Sinq's current resolver is useful application code, but its own liturgical
review records unresolved areas. The API must treat these as review items:

- Lent and Resurrection-season day/Sunday matching needs ecclesiastical review.
- At least one Pentecost seasonal reading is currently unreachable.
- A substantial set of fixed seasonal records is currently unreachable.
- Monthly entries marked for Sunday can be over-applied if weekday is not
  enforced for date-range matches.
- The Prophets' Fast duration has an unresolved 43/44-day interpretation.
- Yekatit 3 has a known Sinksar data-history issue.
- Ge'ez Sinksar content is incomplete.

In particular, `appliesTo: "sunday"` must be enforced for both ordinal-Sunday
and day-range monthly rules. A range must not automatically apply on weekdays.

## 6. Data Quality and Licensing Boundary

### Data quality

- Preserve `raw` keys and original text exactly.
- Assign new stable API IDs; never use titles as identifiers.
- Validate referential integrity from mahlet to sub-feast to feast.
- Validate Ethiopian dates, including Pagumen 6 only in leap years at response
  time.
- Validate canonical book IDs and chapter/verse ranges.
- Record conflicts instead of silently selecting one source.
- Keep religious review separate from software/schema validation.

### Licensing

Sinq's Bible assets identify an 80-book source under CC BY-NC-ND 4.0 and rely on
noncommercial application distribution. EOTCDevAPI is an MIT-licensed public
API project. The Bible text must therefore not be copied into MIT-licensed
artifacts merely because it is present in Sinq. Attribution, translation
provenance, redistribution rights, and API-serving rights require a separate
recorded decision.

Structural facts, field mappings, original code written for this API, and
scripture references can be integrated independently of publishing restricted
verse text.

## 7. Implementation Tasks

Complete these tasks in order.

### Task 1 — Freeze the source snapshot

- Record the exact Sinq revision or content hashes.
- Copy only authorized Gitsawe metadata into a versioned import directory.
- Create a source manifest containing provenance, license notes, counts, and
  hashes.
- Do not duplicate Sinksar because the files are already identical.

Acceptance: every imported file is traceable to its exact origin.

### Task 2 — Define shared schemas

- Add schemas for daily, seasonal, monthly, feast, sub-feast, and mahlet data.
- Define stable enums for cycles, service names, reading slots, review state,
  and resolution state.
- Make TypeScript and Python return the same wire contract.

Acceptance: invalid dates, broken feast links, and malformed references fail
validation in both runtimes.

### Task 3 — Build a lossless importer

- Import Sinq JSON without editing its source files.
- Preserve `raw`, source labels, multilingual incipits, and nonnumeric end notes.
- Map book titles to canonical Bible IDs.
- Emit review flags for unresolved books, malformed ranges, and slot mismatch.

Acceptance: input and normalized record counts reconcile in a generated report.

### Task 4 — Reconcile daily overlap

- Compare the 301 Sinq daily entries with the corresponding fixed scan entries.
- Compare service, slot, book, chapter, start, end, and incipit.
- Classify matches as exact, equivalent-numbering, partial, conflict, or
  unavailable.
- Never let Sinq's missing 64/65 dates erase fixed data.

Acceptance: a machine-readable reconciliation report explains every overlap.

### Task 5 — Import feast relationships and mahlets

- Import the 21 feasts, 40 sub-feasts, and 37 mahlets.
- Validate all foreign keys.
- Assign stable public IDs and retain original Sinq keys as source keys.

Acceptance: no orphan sub-feast or mahlet is published.

### Task 6 — Integrate seasonal matching with Bahire Hasab

- Map Sinq season slugs to canonical API event/season identifiers.
- Add explicit weekday and part semantics.
- Detect unreachable entries through a full Ethiopian-year test matrix.
- Keep unreviewed matches as candidates, not selected services.

Acceptance: every seasonal record is either reachable or has a documented
review issue.

### Task 7 — Correct monthly matching

- Support inclusive ranges, cross-month ranges, ordinal Sundays, and exact days.
- Enforce `appliesTo` on every match path.
- Resolve Tsige through its liturgical season rather than a fictional month.

Acceptance: weekday dates never receive Sunday-only entries.

### Task 8 — Evolve API responses compatibly

- Keep current `gitsawe` and `sinksar` fields during v1.
- Add `candidates`, `selected`, `feasts`, and `mahlets` as additive fields.
- Add collection endpoints only after schema stability:
  - `GET /v1/gitsawe/daily/{ethiopianDate}`
  - `GET /v1/gitsawe/seasons`
  - `GET /v1/gitsawe/monthly`
  - `GET /v1/feasts`
  - `GET /v1/feasts/{id}`
  - `GET /v1/mahlets/{id}`

Acceptance: existing Postman tests remain valid and both implementations have
contract parity.

### Task 9 — Add review and regression gates

- Generate coverage, reachability, conflict, and unresolved-reference reports.
- Test representative fixed, movable, monthly Sunday, cross-month, leap-year,
  and multi-candidate dates.
- Add a reviewed-rule registry with reviewer, decision, evidence, and date.

Acceptance: software tests cannot silently convert an unreviewed liturgical
assumption into an authoritative result.

### Task 10 — Update public documentation

- Document source editions and precedence semantics.
- Explain the difference between `candidate` and `selected`.
- Publish known limitations and review status.
- Update OpenAPI examples and the Postman collection.

Acceptance: clients can tell what the API knows, what it inferred, and what
still requires review.

## 8. Recommended First Implementation Slice

The safest useful first slice is Tasks 1–5 plus additive read-only collection
endpoints. It brings Sinq's clean data organization, feast graph, and mahlet
content into the API without making new claims about liturgical precedence.

Seasonal and monthly candidates should follow only after their matching rules
and reachability reports exist. Automatic `selected` resolution should be the
last step and should require reviewed rules.

