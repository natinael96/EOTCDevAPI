# EOTCDev API — End-to-End Task Plan

## What this project is trying to become

EOTCDev API is intended to be open, free infrastructure for Ethiopian Orthodox
Tewahedo Church calendar applications. It provides the same behavior from a
TypeScript/Hono Cloudflare Worker and a Python/FastAPI package, without a database,
authentication, API keys, or runtime network calls.

The calendar engine is already functional and well tested. The main unfinished work
is turning the Gitsawe endpoint from a fixed-date lookup into a trustworthy daily
liturgical resolver that combines fixed, movable, Sunday, and occasional cycles using
reviewed precedence rules. Production hardening, documentation, publication, and
long-term data maintenance complete the work.

## Current verified baseline (2026-08-28)

- [x] Ethiopian/Gregorian conversion and date descriptions
- [x] Bahire Hasab and movable-feast calculation
- [x] Fasting periods, weekly-fast exceptions, and fixed feasts
- [x] Month calendars, seasons, Ge'ez numerals, batch conversion, and ICS feeds
- [x] Matching TypeScript and Python APIs with shared golden fixtures
- [x] Fixed Gitsawe cycle: 366 possible Ethiopian month/day records
- [x] Sinksar date join: 366 days and 2,308 indexed entries
- [x] 3,342 normalized Gitsawe readings; 3,339 have resolved Bible book IDs
- [x] CI and local `make ci` pass (34 TypeScript tests and 79 Python tests)
- [ ] Three Bible book links and 23 citations still need content review
- [ ] Movable, Sunday, occasional, and printed Bahire Hasab Gitsawe sections are not transcribed
- [ ] Source publication rights are not verified
- [ ] Liturgical precedence is not implemented; `/v1/gitsawe/{date}` correctly reports
      `fixed_candidate_only`

## Definition of done

The project is complete for a stable v1 when:

1. Every supported date can be resolved against all transcribed Gitsawe cycles.
2. The API explains which appointment won, which candidates were considered, and why.
3. Source provenance, confidence, licensing, and transcription coverage are explicit.
4. TypeScript and Python responses remain contract-identical.
5. The public deployment, packages, documentation, monitoring, and maintenance process
   are reproducible.

## Sequential tasks

Work from top to bottom. Start a task only after the previous task's acceptance checks
pass, because later data formats and resolver behavior depend on earlier decisions.

### Task 1 — Freeze the v1 product and data boundary

- Write a short v1 scope document covering supported calendars, year range, endpoints,
  languages, source editions, and explicitly excluded features.
- Confirm that scripture text stays out of the MIT runtime unless compatible publication
  rights are obtained.
- Decide whether full Sinksar narrative text is in v1 or whether v1 exposes titles and
  metadata only.

**Acceptance:** the scope document names every v1 deliverable and non-goal, and the README
links to it.

### Task 2 — Resolve source rights and attribution

- Identify the rights holder and publication terms for the Gitsawe scan and Sinksar data.
- Record title, editor, publisher, edition, scan origin, access date, license/permission,
  and required attribution in machine-readable manifests.
- Keep restricted text out of generated runtime artifacts.

**Acceptance:** each source has a documented status of `permitted`, `restricted`, or
`unknown`; CI rejects content that exceeds its recorded publication permission.

### Task 3 — Define versioned source schemas

- Add JSON Schemas for manifests, fixed days, movable occasions, Sunday ranges,
  occasional services, Sinksar entries, and compiler quality reports.
- Define stable IDs for source, edition, cycle, occasion, service, reading, and entry.
- Make absence distinct from unknown, illegible, not applicable, and not transcribed.

**Acceptance:** all existing data validates against an explicit schema and invalid fixture
tests prove required fields, enums, and ID uniqueness are enforced.

### Task 4 — Strengthen provenance to field level

- Attach printed page, scan page, source edition, transcription status, and review status
  to each appointment and reading.
- Preserve every printed label and citation separately from normalized values.
- Add a correction/audit trail format that does not overwrite source evidence.

**Acceptance:** any API reading can be traced back to an edition and page, and normalized
values can be compared with the original transcription.

### Task 5 — Clear the current fixed-cycle quality backlog

- Review the three unresolved book labels listed in `data/gitsawe/quality-report.json`.
- Review all 23 incomplete citations against the scan.
- Classify each result as confirmed, probable, ambiguous, or unresolved; do not guess.
- Add regression fixtures for corrected and intentionally unresolved cases.

**Acceptance:** no unexplained compiler warnings remain; every remaining ambiguity has a
structured review note and source location.

### Task 6 — Build the transcription QA workflow

- Add commands that create completeness reports, duplicate-ID reports, citation reports,
  and human-review queues.
- Require two-person review or an equivalent documented verification process for
  liturgically significant normalization and precedence data.
- Document how contributors propose corrections with source evidence.

**Acceptance:** a contributor can run one command to validate data and produce a finite,
actionable review queue.

### Task 7 — Model and transcribe the movable Gitsawe cycle

- Define stable occasion keys aligned with the existing Bahire Hasab engine.
- Transcribe movable appointments, including services, alternate readings, provenance,
  and confidence.
- Cover Nineveh, Great Lent milestones, Debre Zeit, Hosanna, Holy Week, Fasika, Erget,
  Peraklitos, and every other occasion present in the source.

**Acceptance:** every printed movable section is accounted for; compiler coverage reports
`movableCycle: transcribed`; known feast dates return the expected movable candidates.

### Task 8 — Model and transcribe the Sunday cycle

- Represent printed Ethiopian date ranges, season/period identity, Sunday sequence,
  mezmur incipits, readings, and year-boundary behavior.
- Implement a pure function that selects the Sunday candidate from a JDN and Ethiopian
  year context without yet applying final precedence.

**Acceptance:** every Sunday across a broad multi-year fixture range selects exactly one
documented Sunday candidate or returns an explicit source-defined gap.

### Task 9 — Model and transcribe occasional/Athanasius readings

- Inventory the supported occasional services and assign stable occasion keys.
- Transcribe appointments with the same provenance and confidence rules as other cycles.
- Keep user-supplied occasion selection separate from automatic calendar resolution.

**Acceptance:** each printed occasional section is represented and can be retrieved by a
stable key with complete source traceability.

### Task 10 — Transcribe and cross-check printed Bahire Hasab tables

- Model the tables as source evidence, not as replacements for the existing algorithm.
- Compare table values with computed Medeb, Wenber, Abekte, Metqi, Mebaja Hamer, Nineveh,
  and movable feast dates.
- Record edition discrepancies rather than silently correcting either side.

**Acceptance:** comparison fixtures cover the source's table range and every mismatch has
a reviewed explanation.

### Task 11 — Specify liturgical precedence

- Obtain and cite authoritative rules for collisions among movable feasts, Sundays,
  fixed commemorations, vigils, and occasional services.
- Express the rules as an ordered, versioned decision table with jurisdiction or edition
  scope where practice varies.
- Define output behavior for ties, regional variants, gaps, and unresolved conflicts.

**Acceptance:** domain reviewers approve the rule document and a collision matrix covers
ordinary days, Sundays, major feasts, Holy Week, and known edge cases.

### Task 12 — Implement a shared resolver contract

- Define language-neutral resolver inputs, candidate records, decisions, explanations,
  and coverage metadata.
- Implement pure resolvers independently in TypeScript and Python.
- Preserve all candidates in the response while clearly identifying the selected service
  order and applied rule IDs.

**Acceptance:** shared fixtures prove both implementations select identical results and
explanations for ordinary dates and every precedence class.

### Task 13 — Evolve `/v1/gitsawe/{date}` safely

- Draft the final response schema and decide whether the behavior is introduced under
  `/v1` additively or as `/v2` if compatibility would be broken.
- Return resolution status, selected appointment, candidates, applied rules, provenance,
  confidence, and coverage.
- Retain `fixed_candidate_only` whenever required layers or rules are unavailable.

**Acceptance:** OpenAPI and golden response fixtures describe all response variants;
existing consumers have a documented migration path.

### Task 14 — Complete API validation and error consistency

- Test query normalization, malformed JSON, unsupported methods/content types, payload
  limits, Unicode input, year boundaries, leap Pagumen, and timezone failures.
- Align CORS and allowed methods with the POST batch route.
- Ensure Hono and FastAPI produce the same intentional error contract.

**Acceptance:** route, status, body, content type, CORS, and cache behavior are covered by
shared parity cases for both success and failure paths.

### Task 15 — Expand correctness testing

- Add property tests for conversion round trips, monotonic JDNs, weekday continuity,
  feast invariants, fast boundaries, resolver determinism, and schema invariants.
- Add independently sourced historical/modern reference dates and document each source.
- Test the entire supported year range or clearly enforce a narrower validated range.

**Acceptance:** tests fail on seeded faults in conversion, movable calculations, fasting,
cycle selection, and precedence; `make ci` remains the single full verification command.

### Task 16 — Make generated artifacts reproducible and reviewable

- Pin runtime/toolchain versions and ensure generation is byte-deterministic.
- Split very large fixtures where needed and provide summary diffs for behavior changes.
- Add generated-file headers and a check that prevents manual edits.

**Acceptance:** two clean generations produce identical hashes, and CI fails with clear
instructions when data or generated files are stale.

### Task 17 — Complete public API documentation

- Document every endpoint, parameter, schema, example, error, cache policy, and supported
  range in English and Amharic where practical.
- Explain Amete Mihret, Gena/Timket shifts, fasting exceptions, coverage, confidence,
  precedence, licensing, and regional variation.
- Publish copy-paste examples for JavaScript, Python, curl, and calendar subscription.

**Acceptance:** a new developer can integrate without reading source code, and all examples
are exercised in CI or generated from tested fixtures.

### Task 18 — Package and release both implementations

- Define semantic-versioning and deprecation policies for API, data, and resolver rules.
- Build and test the Python wheel/sdist and decide whether to publish the TypeScript core
  as a package in addition to deploying the Worker.
- Produce checksums, changelog entries, source/data version metadata, and release notes.

**Acceptance:** a tagged release can be rebuilt from a clean checkout and installed in
minimal Python and JavaScript consumer projects.

### Task 19 — Harden and deploy production

- Configure the Cloudflare environment, custom domain, TLS, observability, security
  headers, cache behavior, and a rollback procedure.
- Add deployment smoke tests for health, representative dates, Gitsawe resolution, batch
  conversion, ICS bytes, CORS, and OpenAPI.
- Confirm the no-database/no-runtime-network architecture and Worker size/CPU limits.

**Acceptance:** deployment is automated from a protected release workflow, smoke tests
pass, and rollback has been rehearsed.

### Task 20 — Add operational monitoring

- Monitor availability, latency, 5xx rate, endpoint correctness canaries, and certificate
  expiry without collecting unnecessary user data.
- Publish status/contact information and define incident severity and response steps.
- Alert on unexpected response drift between deployed TypeScript and Python reference
  implementations.

**Acceptance:** a simulated outage and a seeded incorrect canary response both trigger an
actionable alert and follow the documented response path.

### Task 21 — Establish data governance and maintenance

- Define maintainers, domain reviewers, correction SLAs, source acceptance criteria, and
  how regional variants are represented.
- Version source transcriptions and resolver rules independently from application code.
- Schedule periodic source, dependency, security, and calendar-reference reviews.

**Acceptance:** ownership is explicit, a correction can move from report to reviewed
release through a documented workflow, and historical API behavior remains reproducible.

### Task 22 — Declare stable v1

- Run the complete test, packaging, licensing, documentation, deployment, and monitoring
  checklists from a clean checkout.
- Publish the supported-range and known-limitations statement.
- Tag v1.0.0 only after required domain and technical approvals are recorded.

**Acceptance:** all preceding tasks are complete, no critical unresolved data or licensing
issues remain, both implementations pass the release contract, and the production API is
documented and monitored.

## Rule for executing this roadmap

For each task: open one focused issue, cite the relevant source evidence, change the data
model before generated artifacts, implement both language behaviors when applicable,
regenerate shared fixtures, run `make ci`, review the fixture diff, update documentation,
and only then mark the task complete.
