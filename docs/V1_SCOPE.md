# EOTCDev API v1 Scope

## Product contract

EOTCDev API v1 is a read-oriented, stateless API and reusable calendar core for
Ethiopian Orthodox Tewahedo Church calendar applications. The canonical public
runtime is the TypeScript/Hono Cloudflare Worker. The Python/FastAPI implementation
is an independently implemented reference and self-hosting option. Shared fixtures
hold their HTTP behavior identical.

The service requires no account, API key, database, or runtime call to another
service. All responses are computed from versioned code and bundled, permitted data.

## Supported runtime and input range

- Node.js 22 and Python 3.12 are the development and CI baselines.
- Ethiopian years use Amete Mihret.
- Public year parameters accept `1` through `9999`; correctness fixtures emphasize
  modern dates and the documented 1800–2200 EC verification range.
- Dates use `YYYY-MM-DD` and explicitly identify Gregorian or Ethiopian input.
- The default civil timezone for `today` is `Africa/Addis_Ababa`.

The broad accepted year range is an arithmetic capability, not a claim that every
historical liturgical practice or source edition is uniform across that range.

## v1 deliverables

1. Ethiopian/Gregorian conversion and complete date descriptions.
2. Bahire Hasab calculations with inspectable intermediate values.
3. Fixed and movable feasts, fasting periods/status, and documented exceptions.
4. Ethiopian month calendars, liturgical seasons, Ge'ez numerals, batch conversion,
   and deterministic iCalendar feeds.
5. A date-level Gitsawe/Sinksar endpoint with Bible references and explicit source,
   coverage, confidence, and resolution metadata.
6. Resolution across fixed, movable, and Sunday Gitsawe cycles once their source data
   and precedence rules have been transcribed and reviewed.
7. Occasional readings retrievable by explicit occasion; they are not automatically
   selected without sufficient context.
8. Contract-identical TypeScript and Python HTTP responses, tested through shared
   conformance and response fixtures.
9. Reproducible packages, public documentation, automated deployment, and operational
   checks.

## Content and licensing boundary

- Calendar facts, normalized citation metadata, source references, and content that is
  confirmed redistributable may be included in the MIT runtime.
- Bible verse text from the local `am-1980` and `gez-1980` editions is not bundled.
  Those editions are marked CC BY-NC-ND 4.0 and are used only for permitted local
  validation.
- Gitsawe incipits, Psalm verse strings, and full Sinksar narratives remain excluded
  from generated runtime artifacts until their publication rights are recorded.
- The v1 Sinksar response is therefore limited to entry IDs, types, titles, counts,
  availability status, and source/provenance metadata.
- Unknown rights status is treated as restricted, never as permission.

## Compatibility

- Existing `/v1` fields will not be removed or change meaning in a minor release.
- New optional fields and endpoints may be added to `/v1`.
- A breaking response or resolver semantic change requires `/v2` or a new major
  package version with a documented migration path.
- API behavior, source content, generated catalogs, and precedence rules each carry a
  version so a historical result can be reproduced.

## Explicit non-goals for v1

- Hosting copyrighted scripture text or unlicensed full source books.
- User accounts, authentication, personalization, notifications, or a content database.
- Claiming one regional custom is universal when reviewed sources disagree.
- Automatically matching Gitsawe names to Sinksar narratives as authoritative identity.
- Inventing missing appointments, citations, precedence, translations, or source text.
- Providing pastoral, canonical, or ecclesiastical rulings.

## Completion gate

Stable v1 requires all implemented calendar behavior to pass both suites, every runtime
record to carry sufficient provenance, all automatic Gitsawe decisions to cite reviewed
precedence rules, restricted content to remain excluded, and the deployed API to pass
release smoke tests. Where source coverage is incomplete, the API must continue to say
so rather than presenting a candidate as a final service order.
