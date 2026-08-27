# Gitsawe source model

## What Gitsawe represents

`መጽሐፈ ግጻዌ` is an appointment book for worship. It does not merely attach a
Bible passage to a civil date. The source represented in this repository contains
five distinct layers:

1. `ግጻዌ ዘወርኃት` — fixed appointments indexed by Ethiopian month and day.
2. Movable-feast appointments indexed by an occasion calculated from Bahire Hasab.
3. `ግጻዌ ዘሰናብት` — Sunday appointments indexed by an Ethiopian date range and
   carrying a mezmur (hymn) incipit.
4. Athanasius readings for occasional services.
5. Printed Bahire Hasab tables.

Only layer 1 is currently transcribed. The API must not present it as the final
appointment when a Sunday, movable feast, or other higher-ranking occasion may
interact with it. Until the remaining layers and precedence rules are reviewed,
responses identify the fixed cycle as a candidate appointment.

## Fixed-day structure

Every possible Ethiopian month/day is present: 30 days in months 1–12 and six
possible Pagumen days. A day has a commemoration and up to three services:

- `ዘነግህ` — morning office (Matins)
- `ዘቅዳሴ` — Divine Liturgy
- `ዘሠርክ` — evening office (Vespers)

A service can contain:

- `ምስባክ` — three appointed Psalm verses
- `ወንጌል` — Gospel citation and Ge'ez incipit
- `epistles_and_acts` — normally Pauline, Catholic Epistle, and Acts readings
- `ቅዳሴ` — appointed anaphora; this is a liturgical name, not a Bible reading
- an additional (`ዓዲ`, "again") Psalm or Gospel appointment

Absence is meaningful and must not be filled by invention.

## Date and content joins

Gitsawe and Sinksar are joined by `(ethiopian_month, ethiopian_day)`. This means
they belong to the same calendar date; it does not assert that every Gitsawe name
has one corresponding Sinksar narrative. Ge'ez and Amharic spelling, morphology,
translation, and differences between the two source collections make automatic
name-level joins unsuitable as authoritative data.

Movable Gitsawe sections will be joined to the calendar engine by stable occasion
keys such as `nineveh`, `abiy_tsome`, `debre_zeit`, `hosanna`, `siklet`, `fasika`,
`erget`, and `peraklitos`. Sunday sections require a separate resolver based on
the printed Ethiopian date ranges and liturgical season.

## Bible references

Each reading carries two reference layers:

- `sourceCitation` preserves the printed Gitsawe text exactly.
- `canonicalReference` is a derived book/chapter/verse reference with a confidence
  level and derivation method.

Canonical book IDs follow the Bible collection's IDs (`MAT`, `MRK`, `LUK`, `JHN`,
`ACT`, `ROM`, and so on). A canonical reference may be derived from:

1. a structurally valid printed citation and normalized book label;
2. a unique match for the Ge'ez incipit in a named Bible edition;
3. agreement between both methods.

The compiler must never overwrite the source citation. A discrepancy becomes a
review item. A short or repeated incipit may have multiple candidates and must be
reported as ambiguous.

## Psalm numbering

Psalm numbering in the source may differ from modern editions, and Gitsawe
versification can differ by one or two verses from the available Bible text.
Therefore, the API preserves the source numbering and identifies the edition used
for any derived canonical link. It must not silently convert Psalm numbering.

## Provenance and confidence

Normalized records retain:

- source title, publisher, editor, and edition note
- scan and printed page numbers
- original field labels and citation text
- normalized field type and canonical book ID
- derivation method and confidence
- ambiguity candidates and review notes
- transcription coverage for each Gitsawe layer

Confidence values are `confirmed`, `probable`, `ambiguous`, and `unresolved`.

## Licensing boundary

The Bible files are licensed CC BY-NC-ND 4.0 and are intentionally excluded from
the MIT source repository. Canonical references and local validation may use the
installed collection, but Bible verse text must not be bundled into the MIT API,
adapted, or represented as commercially reusable. Any future verse-text endpoint
must preserve attribution, edition identity, license notices, and the
noncommercial/no-derivatives restrictions.

For the same reason, the generated runtime catalog omits Psalm verse strings and
Gospel incipits transcribed inside the Gitsawe source. It exposes appointment
metadata and citations, not scripture text.

The publication rights and attribution requirements for the Gitsawe scan and
Sinksar text must also be recorded before presenting their full text as generally
redistributable API content.

## Resolution status returned by the API

Until all liturgical layers and precedence rules are implemented, a resolved day
must report coverage explicitly:

```json
{
  "coverage": {
    "fixedCycle": "transcribed",
    "movableCycle": "not_transcribed",
    "sundayCycle": "not_transcribed",
    "occasionalCycle": "not_transcribed"
  },
  "resolution": "fixed_candidate_only"
}
```

This prevents consumers from mistaking incomplete transcription coverage for a
complete liturgical determination.
