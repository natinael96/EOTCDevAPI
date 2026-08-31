/**
 * EOTCDev API -- Hono application.
 *
 * Every route is pure computation: no database, no network, no state. That is
 * what lets the whole thing sit inside a Cloudflare Worker's free tier and
 * answer in well under a millisecond of CPU.
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import {
  MONTHS, WEEKDAYS, gregorianToJDN, ethiopicToJDN, jdnToEthiopic,
  daysInEthiopicMonth, isEthiopicLeapYear, jdnToWeekday,
} from './core/ethiopic.ts';
import { bahireHasab, movableFeasts, MOVABLE_FEASTS } from './core/bahirehasab.ts';
import { fastPeriods } from './core/fasts.ts';
import { fixedFeasts } from './core/feasts.ts';
import { describeDay, iso, ethIso } from './core/day.ts';
import { toGeez } from './core/geez.ts';
import { seasonOf } from './core/seasons.ts';
import { buildIcs } from './core/ical.ts';
import { fixedGitsaweOn, gitsaweCoverage, searchSinksar } from './core/gitsawe.ts';
import { bibleBooks, bibleBook, bibleEditions, bibleVersification, bibleCanonNote, resolveBook } from './core/bible.ts';
import { sinqCatalog, sinqSeasonal, sinqMonthly, sinqFeasts, sinqSubFeasts, sinqMahlets } from './core/sinq.ts';
import { parseCitation } from './core/citations.ts';
import { feastByKey, searchFeasts } from './core/feast-search.ts';
import { TokenBucketLimiter } from './core/rate-limit.ts';

type Bindings = {
  API_RATE_LIMITER?: RateLimit;
  RATE_LIMIT_CAPACITY?: string;
  RATE_LIMIT_REFILL_PER_SECOND?: string;
};

const app = new Hono<{ Bindings: Bindings }>();
const dynamicLimiter = new TokenBucketLimiter();

app.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'OPTIONS'] }));

// Cloudflare's binding is deliberately optional so the pure application can be
// embedded and tested without platform state. Production config supplies it.
app.use('/v1/*', async (c, next) => {
  if (c.req.method === 'OPTIONS' || c.req.path === '/v1/health') return next();
  const limiter = c.env?.API_RATE_LIMITER;
  if (!limiter && c.env?.RATE_LIMIT_CAPACITY === undefined) return next();
  // Cloudflare supplies this header at the trusted edge. Do not fall back to
  // X-Forwarded-For: a direct caller can forge it and rotate limiter keys.
  const client = c.req.header('cf-connecting-ip') ?? 'anonymous';
  const capacity = Number(c.env?.RATE_LIMIT_CAPACITY ?? 60);
  const refill = Number(c.env?.RATE_LIMIT_REFILL_PER_SECOND ?? 10);
  const dynamic = dynamicLimiter.take(client, capacity, refill);
  if (!dynamic.allowed) {
    return c.json({
      error: 'rate_limited',
      message: `Too many requests. Please retry after ${dynamic.retryAfter} seconds.`,
      retryAfter: dynamic.retryAfter,
    }, 429, { 'retry-after': String(dynamic.retryAfter), 'cache-control': 'no-store' });
  }
  if (limiter && !(await limiter.limit({ key: client })).success) {
    return c.json({
      error: 'rate_limited', message: 'Too many requests. Please retry after 60 seconds.', retryAfter: 60,
    }, 429, { 'retry-after': '60', 'cache-control': 'no-store' });
  }
  return next();
});

// Explicitly dated computations are immutable. Clock-dependent routes must be
// revalidated so a shared cache cannot serve yesterday's result for 24 hours.
app.use('/v1/*', async (c, next) => {
  await next();
  if (c.res.status !== 200) return;
  if (c.req.path === '/v1/health') {
    c.res.headers.set('cache-control', 'no-store');
  } else if (c.req.path === '/v1/today' || (c.req.path === '/v1/upcoming' && !c.req.query('from'))) {
    c.res.headers.set('cache-control', 'public, max-age=60, must-revalidate');
  } else {
    c.res.headers.set('cache-control', 'public, max-age=86400');
  }
});

class ApiError extends Error {
  status: 400 | 404;
  hint?: string;
  // Written out longhand rather than as parameter properties: Node's
  // strip-only TypeScript mode does not support those, and the conformance
  // scripts run under plain `node --experimental-strip-types`.
  constructor(status: 400 | 404, message: string, hint?: string) {
    super(message);
    this.status = status;
    this.hint = hint;
  }
}

const DATE_RE = /^(\d{1,4})-(\d{1,2})-(\d{1,2})$/;

/** Parse `YYYY-MM-DD` in either calendar into a JDN. */
function parseDate(raw: string, calendar: string): number {
  const m = DATE_RE.exec(raw.trim());
  if (!m) {
    throw new ApiError(400, `Could not parse date '${raw}'.`, 'Expected YYYY-MM-DD, e.g. 2026-04-12.');
  }
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];

  if (calendar === 'ethiopian' || calendar === 'ethiopic') {
    if (mo < 1 || mo > 13) throw new ApiError(400, `Ethiopian month must be 1-13, got ${mo}.`);
    const dim = daysInEthiopicMonth(y, mo);
    if (d < 1 || d > dim) {
      throw new ApiError(400, `${MONTHS[mo - 1].translit} ${y} has ${dim} days, got day ${d}.`,
        mo === 13 ? 'Pagumen has 5 days, or 6 in a leap year.' : undefined);
    }
    return ethiopicToJDN(y, mo, d);
  }

  if (calendar !== 'gregorian') {
    throw new ApiError(400, `Unknown calendar '${calendar}'.`, "Use 'gregorian' or 'ethiopian'.");
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) throw new ApiError(400, `Invalid Gregorian date '${raw}'.`);
  const jdn = gregorianToJDN(y, mo, d);
  // Reject dates like 2026-02-31 that survive the arithmetic but do not exist.
  if (iso(jdn) !== `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`) {
    throw new ApiError(400, `'${raw}' is not a real Gregorian date.`);
  }
  return jdn;
}

function parseYear(raw: string): number {
  const y = Number(raw);
  if (!Number.isInteger(y) || y < 1 || y > 9999) {
    throw new ApiError(400, `Ethiopian year must be an integer 1-9999, got '${raw}'.`,
      'The current Ethiopian year is roughly the Gregorian year minus 8.');
  }
  return y;
}

const ethIsoOf = (jdn: number) => { const e = jdnToEthiopic(jdn); return ethIso(e.year, e.month, e.day); };

const cal = (c: any) => (c.req.query('calendar') ?? 'gregorian').toLowerCase();

app.get('/', (c) =>
  c.json({
    name: 'EOTCDev API',
    description:
      'Open calendar data for the Ethiopian Orthodox Tewahedo Church: date conversion, ' +
      'fasting days, fasting periods, and feasts.',
    version: '0.1.0',
    license: 'MIT',
    documentation: 'https://natinael96.github.io/EOTCDevAPI/docs/',
    website: 'https://natinael96.github.io/EOTCDevAPI/',
    openapi: '/v1/openapi.json',
    note: 'All Ethiopian years are Amete Mihret. Dates are YYYY-MM-DD. No auth, no API key; a generous anonymous rate limit applies.',
    endpoints: {
      'GET /v1/health': 'Liveness check.',
      'GET /v1/today': "Today, fully described. ?tz=Africa/Addis_Ababa&include=readings,sinksar",
      'GET /v1/date/{date}': 'Describe any date. ?calendar=gregorian|ethiopian',
      'GET /v1/convert/{date}': 'Convert between calendars. ?calendar=gregorian|ethiopian',
      'GET /v1/fasting/{date}': 'Is it a fasting day, and why. ?calendar=gregorian|ethiopian',
      'GET /v1/fasts/{year}': 'All fasting periods of an Ethiopian year.',
      'GET /v1/feasts/{year}': 'All feasts. ?type=all|movable|fixed',
      'GET /v1/feasts/{year}/{key}': 'One feast resolved for a year, by key, name, or alias.',
      'GET /v1/feasts/search': 'Find a feast by any of its names, homophone-aware. ?q=&year=',
      'GET /v1/upcoming': 'Upcoming feasts and fasts. ?days=30&type=all|feasts|fasts',
      'GET /v1/bahire-hasab/{year}': 'The full ባሕረ ሐሳብ computation.',
      'GET /v1/calendar/{year}/{month}': 'One Ethiopian month, day by day.',
      'GET /v1/calendar/range': 'Describe a date range, up to 366 days. ?start=&end=&calendar=',
      'GET /v1/calendar/ics': 'iCalendar feed. ?year=2018&type=fasting|feasts|readings|all',
      'GET /v1/calendar/season': 'Liturgical season of a date. ?date=&calendar=',
      'GET /v1/calendar/geez-numeral': "Arabic to Ge'ez numerals. ?number=2018",
      'GET /v1/gitsawe/{date}': 'Fixed-cycle Gitsawe with Sinksar and canonical Bible links.',
      'GET /v1/gitsawe/seasons': 'Movable-cycle reading candidates by season. ?season=abiyTsom',
      'GET /v1/gitsawe/monthly': 'Monthly Sunday-cycle reading candidates.',
      'GET /v1/gitsawe/feasts': 'The feast graph: feasts, sub-feasts, and mahlet service orders.',
      'GET /v1/gitsawe/mahlets/{id}': 'One mahlet service order with its chant roles.',
      'GET /v1/sinksar/{date}': "The day's Sinksar annual and monthly commemoration lists.",
      'GET /v1/readings/{date}': 'Daily Psalms, Gospels, Epistles and Acts from the Gitsawe.',
      'GET /v1/bible/books': 'The canon: book metadata and verse counts. ?testament=&section=',
      'GET /v1/bible/books/{id}': 'One book with per-chapter verse counts.',
      'GET /v1/bible/editions': 'Bible editions registry and licensing.',
      'GET /v1/bible/parse': 'Parse a citation into a canonical reference. ?q=',
      'GET /v1/bible/{edition}/{book}/{chapter}': 'Chapter reference; verse text only on licensed self-hosts.',
      'POST /v1/calendar/convert/batch': 'Convert many dates at once. body: {dates:[], calendar?}',
    },
    examples: [
      '/v1/today',
      '/v1/date/2026-04-12',
      '/v1/fasting/2026-03-04',
      '/v1/fasts/2018',
      '/v1/bahire-hasab/2018',
      '/v1/calendar/2018/1',
    ],
  }),
);

app.get('/v1/health', (c) => c.json({ status: 'ok', version: '0.1.0' }));

// Optional payloads for /v1/today. A daily companion wants the readings and
// the day's commemorations on one screen; everyone else wants the small
// response they already have, so these are opt-in and the default is unchanged.
const TODAY_INCLUDES = ['readings', 'sinksar'];

function parseInclude(raw: string | undefined): Set<string> {
  const wanted = (raw ?? '').split(',').map((part) => part.trim().toLowerCase()).filter(Boolean);
  for (const name of wanted) {
    if (!TODAY_INCLUDES.includes(name)) {
      throw new ApiError(400, `Unknown include '${name}'.`, `Use ${TODAY_INCLUDES.join(' and/or ')}.`);
    }
  }
  return new Set(wanted);
}

app.get('/v1/today', (c) => {
  const tz = c.req.query('tz') ?? 'Africa/Addis_Ababa';
  const include = parseInclude(c.req.query('include'));
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
  } catch {
    throw new ApiError(400, `Unknown timezone '${tz}'.`, 'Use an IANA name, e.g. Africa/Addis_Ababa.');
  }
  const g = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const jdn = gregorianToJDN(Number(g.year), Number(g.month), Number(g.day));
  const described = describeDay(jdn);
  const body: Record<string, unknown> = { timezone: tz, ...described };
  if (include.size) {
    const fixed = fixedGitsaweOn(described.ethiopic.month, described.ethiopic.day);
    if (include.has('readings')) {
      const gitsawe = fixed?.gitsawe as { cycle: string; services: Record<string, any> } | undefined;
      body.readings = gitsawe ? {
        source: { cycle: gitsawe.cycle, resolution: 'fixed_candidate_only' },
        services: readingServices(gitsawe),
      } : null;
    }
    // Who is commemorated today: the annual and monthly names, as displayed.
    // The full entries, with their headings and source text, stay on
    // /v1/sinksar/{date}; this is the reading list, not the archive record.
    if (include.has('sinksar')) {
      const sinksar = fixed?.sinksar as {
        entryCount: number;
        annualFeasts: { items: { title: string }[] };
        monthlyFeasts: { items: { title: string }[] };
      } | undefined;
      body.sinksar = sinksar ? {
        annual: sinksar.annualFeasts.items.map((item) => item.title),
        monthly: sinksar.monthlyFeasts.items.map((item) => item.title),
        entryCount: sinksar.entryCount,
      } : null;
    }
  }
  return c.json(body);
});

app.get('/v1/date/:date', (c) => c.json(describeDay(parseDate(c.req.param('date'), cal(c)))));

app.get('/v1/convert/:date', (c) => {
  const jdn = parseDate(c.req.param('date'), cal(c));
  const d = describeDay(jdn);
  return c.json({ jdn: d.jdn, gregorian: d.gregorian, ethiopic: d.ethiopic, weekday: d.weekday });
});

app.get('/v1/fasting/:date', (c) => {
  const jdn = parseDate(c.req.param('date'), cal(c));
  const d = describeDay(jdn);
  return c.json({
    jdn: d.jdn, gregorian: d.gregorian.date, ethiopic: d.ethiopic.date,
    weekday: d.weekday, ...d.fasting,
  });
});

// ---- Gitsawe cycle collections ---------------------------------------------
// Reference data for the movable and monthly lectionary layers. Served as
// candidate cycles: the API does not yet apply them to dates, because the
// precedence rules that would pick a winner are not reviewed.

const CYCLE_NOTE = 'Candidate reference data: these cycles are not yet applied to date resolution; /v1/gitsawe/{date} remains fixed_candidate_only until precedence rules are reviewed.';

app.get('/v1/gitsawe/seasons', (c) => {
  const filter = c.req.query('season') ?? null;
  const all = sinqSeasonal();
  if (filter && !all.some((entry) => entry.season === filter)) {
    const known = [...new Set(all.map((entry) => entry.season))].sort().join(', ');
    throw new ApiError(400, `Unknown season '${filter}'.`, `Known seasons: ${known}.`);
  }
  const seasons = filter ? all.filter((entry) => entry.season === filter) : all;
  return c.json({
    resolution: 'candidates_only',
    note: CYCLE_NOTE,
    textPolicy: sinqCatalog().source.textPolicy,
    count: seasons.length,
    seasons,
  });
});

app.get('/v1/gitsawe/monthly', (c) =>
  c.json({
    resolution: 'candidates_only',
    note: CYCLE_NOTE,
    textPolicy: sinqCatalog().source.textPolicy,
    count: sinqMonthly().length,
    entries: sinqMonthly(),
  }));

app.get('/v1/gitsawe/feasts', (c) => {
  const mahletsBySubFeast = new Map<string, { id: string; title: string; chantCount: number }[]>();
  for (const mahlet of sinqMahlets()) {
    const list = mahletsBySubFeast.get(mahlet.subFeast) ?? [];
    list.push({ id: mahlet.id, title: mahlet.title, chantCount: mahlet.chants.length });
    mahletsBySubFeast.set(mahlet.subFeast, list);
  }
  const feasts = sinqFeasts().map((feast) => ({
    id: feast.id,
    name: feast.name,
    amharicName: feast.amharicName,
    month: feast.month,
    monthNum: feast.monthNum,
    day: feast.day,
    dateKey: feast.dateKey,
    movable: feast.movable,
    provenance: feast.provenance,
    subFeasts: sinqSubFeasts()
      .filter((sub) => sub.feast === feast.id)
      .map((sub) => ({
        id: sub.id,
        name: sub.name,
        amharicName: sub.amharicName,
        mahlets: mahletsBySubFeast.get(sub.id) ?? [],
      })),
  }));
  return c.json({
    resolution: 'candidates_only',
    note: CYCLE_NOTE,
    count: {
      feasts: feasts.length,
      subFeasts: sinqSubFeasts().length,
      mahlets: sinqMahlets().length,
    },
    feasts,
  });
});

app.get('/v1/gitsawe/mahlets/:id', (c) => {
  const raw = c.req.param('id');
  const wanted = raw.startsWith('mahlet:') ? raw : `mahlet:${raw}`;
  const mahlet = sinqMahlets().find((entry) => entry.id === wanted) ?? null;
  if (!mahlet) {
    throw new ApiError(404, `Unknown mahlet '${raw}'.`, 'See /v1/gitsawe/feasts for the list.');
  }
  const subFeast = sinqSubFeasts().find((sub) => sub.id === mahlet.subFeast)!;
  const feast = sinqFeasts().find((entry) => entry.id === subFeast.feast)!;
  return c.json({
    id: mahlet.id,
    title: mahlet.title,
    subFeast: { id: subFeast.id, name: subFeast.name, amharicName: subFeast.amharicName },
    feast: { id: feast.id, name: feast.name, amharicName: feast.amharicName },
    chantSource: mahlet.chantSource,
    chants: mahlet.chants,
    chantTextAvailable: mahlet.chantTextAvailable,
    textPolicy: sinqCatalog().source.textPolicy,
  });
});

app.get('/v1/gitsawe/:date', (c) => {
  const jdn = parseDate(c.req.param('date'), cal(c));
  const described = describeDay(jdn);
  const fixed = fixedGitsaweOn(described.ethiopic.month, described.ethiopic.day);
  if (!fixed) throw new ApiError(404, 'No fixed-cycle Gitsawe record for this date.');
  const movableFeasts = described.feasts.filter((feast) => feast.movable).map((feast) => feast.key);
  const isSunday = described.weekday.n === 0;
  return c.json({
    date: {
      gregorian: described.gregorian.date,
      ethiopic: described.ethiopic.date,
      weekday: described.weekday,
    },
    coverage: gitsaweCoverage(),
    resolution: 'fixed_candidate_only',
    resolutionFactors: {
      isSunday,
      movableFeasts,
      knownPrecedenceConflict: isSunday || movableFeasts.length > 0,
      note: 'Sunday and movable Gitsawe cycles are not yet transcribed; precedence is not resolved.',
    },
    gitsawe: fixed.gitsawe,
    sinksar: fixed.sinksar,
    bible: {
      textIncluded: false,
      localEditions: ['gez-1980', 'am-1980'],
      license: 'CC-BY-NC-ND-4.0',
      note: 'Canonical references identify passages; Bible verse text is not bundled with the MIT API.',
    },
  });
});

// Registered before /v1/sinksar/:date so 'search' is not read as a date.
const SINKSAR_SEARCH_LIMIT = 200;
app.get('/v1/sinksar/search', (c) => {
  const q = c.req.query('q');
  if (!q || !q.trim()) {
    throw new ApiError(400, "Missing query parameter 'q'.", 'Example: /v1/sinksar/search?q=ሚካኤል');
  }
  const yearParam = c.req.query('year');
  const year = yearParam ? parseYear(yearParam) : null;
  const all = searchSinksar(q);
  const matches = all.slice(0, SINKSAR_SEARCH_LIMIT).map((match) => {
    const ethiopic = ethIso(year ?? 1, match.ethiopianMonth, match.ethiopianDay);
    return {
      title: match.title,
      kind: match.kind,
      ethiopianMonth: match.ethiopianMonth,
      ethiopianDay: match.ethiopianDay,
      monthName: MONTHS[match.ethiopianMonth - 1],
      confidence: match.confidence,
      ...(year ? {
        date: {
          ethiopic,
          gregorian: iso(ethiopicToJDN(year, match.ethiopianMonth, match.ethiopianDay)),
          weekday: { ...WEEKDAYS[jdnToWeekday(ethiopicToJDN(year, match.ethiopianMonth, match.ethiopianDay))] },
        },
      } : {}),
    };
  });
  return c.json({
    query: q,
    ethiopicYear: year,
    count: matches.length,
    totalMatches: all.length,
    truncated: all.length > matches.length,
    note: 'Monthly commemorations recur, so one name can match the same day in several months.',
    matches,
  });
});

app.get('/v1/sinksar/:date', (c) => {
  const jdn = parseDate(c.req.param('date'), cal(c));
  const described = describeDay(jdn);
  const fixed = fixedGitsaweOn(described.ethiopic.month, described.ethiopic.day);
  const sinksar = fixed?.sinksar as {
    entryCount: number;
    annualFeasts: Record<string, unknown>;
    monthlyFeasts: Record<string, unknown>;
    fullTextAvailable: boolean;
    reason: string;
  } | null;
  if (!sinksar) throw new ApiError(404, 'No Sinksar record for this date.');
  return c.json({
    date: {
      gregorian: described.gregorian.date,
      ethiopic: described.ethiopic.date,
      weekday: described.weekday,
    },
    annualFeasts: sinksar.annualFeasts,
    monthlyFeasts: sinksar.monthlyFeasts,
    entryCount: sinksar.entryCount,
    fullTextAvailable: sinksar.fullTextAvailable,
    reason: sinksar.reason,
  });
});

// Shared by /v1/readings/{date} and /v1/today?include=readings, so the two can
// never describe the same day's services differently.
function readingServices(gitsawe: { services: Record<string, any> }) {
  return Object.fromEntries(Object.entries(gitsawe.services).map(([name, service]) => [name, {
    psalms: service.psalms ?? [],
    gospels: service.gospels ?? [],
    epistles: (service.epistlesAndActs ?? []).filter((reading: any) => reading.bibleBook !== 'ACT'),
    acts: (service.epistlesAndActs ?? []).filter((reading: any) => reading.bibleBook === 'ACT'),
    anaphora: service.anaphora ?? null,
  }]));
}

app.get('/v1/readings/:date', (c) => {
  const jdn = parseDate(c.req.param('date'), cal(c));
  const described = describeDay(jdn);
  const fixed = fixedGitsaweOn(described.ethiopic.month, described.ethiopic.day);
  if (!fixed) throw new ApiError(404, 'No fixed-cycle Gitsawe record for this date.');
  const gitsawe = fixed.gitsawe as { cycle: string; services: Record<string, any> };
  const services = readingServices(gitsawe);
  const movableFeastKeys = described.feasts.filter((feast) => feast.movable).map((feast) => feast.key);
  return c.json({
    date: { gregorian: described.gregorian.date, ethiopic: described.ethiopic.date, weekday: described.weekday },
    source: { cycle: gitsawe.cycle, resolution: 'fixed_candidate_only' },
    resolutionFactors: {
      isSunday: described.weekday.n === 0,
      movableFeasts: movableFeastKeys,
      knownPrecedenceConflict: described.weekday.n === 0 || movableFeastKeys.length > 0,
    },
    services,
    bible: {
      textIncluded: false,
      availableLocalEditions: ['gez-1980', 'am-1980'],
      license: 'CC-BY-NC-ND-4.0',
      note: 'This public MIT API exposes Gitsawe citations and normalized references, not licensed Bible verse text.',
    },
  });
});

app.get('/v1/fasts/:year', (c) => {
  const year = parseYear(c.req.param('year'));
  return c.json({
    ethiopicYear: year,
    periods: fastPeriods(year).map((p) => ({
      key: p.key, amharic: p.amharic, translit: p.translit, english: p.english,
      movable: p.movable, days: p.days,
      start: { gregorian: iso(p.startJDN), ethiopic: ethIsoOf(p.startJDN) },
      end: { gregorian: iso(p.endJDN), ethiopic: ethIsoOf(p.endJDN) },
      description: p.description,
    })),
    weeklyFast: {
      amharic: 'ጾመ ድህነት', translit: 'Tsome Dihnet', english: 'Fast of Salvation',
      rule: 'Every Wednesday and Friday, suspended during the fifty days from Fasika to Pentecost, ' +
            'and on the great feasts of the Lord (Gena, Timket).',
    },
  });
});

app.get('/v1/feasts/search', (c) => {
  const q = c.req.query('q');
  if (!q || !q.trim()) throw new ApiError(400, "Missing query parameter 'q'.", 'Example: /v1/feasts/search?q=ትንሳኤ');
  const yearParam = c.req.query('year');
  const year = yearParam ? parseYear(yearParam) : null;
  const matches = searchFeasts(q).map((match) => ({
    key: match.definition.key,
    amharic: match.definition.amharic,
    translit: match.definition.translit,
    english: match.definition.english,
    movable: match.definition.movable,
    aliases: match.definition.aliases,
    matchedOn: match.matchedOn,
    matchedValue: match.matchedValue,
    confidence: match.confidence,
    ...(year ? { date: resolveFeastForYear(match.definition, year) } : {}),
  }));
  return c.json({
    query: q, normalized: true, ethiopicYear: year, count: matches.length, matches,
  });
});

app.get('/v1/feasts/:year', (c) => {
  const year = parseYear(c.req.param('year'));
  const type = (c.req.query('type') ?? 'all').toLowerCase();
  if (!['all', 'movable', 'fixed'].includes(type)) {
    throw new ApiError(400, `Unknown type '${type}'.`, "Use 'all', 'movable' or 'fixed'.");
  }
  const movable = movableFeasts(year).map((f) => ({
    key: f.key, amharic: f.amharic, translit: f.translit, english: f.english,
    movable: true, gregorian: iso(f.jdn), ethiopic: ethIsoOf(f.jdn),
    weekday: { ...WEEKDAYS[f.weekday] },
  }));
  const fixed = fixedFeasts(year).map((f) => ({
    key: f.key, amharic: f.amharic, translit: f.translit, english: f.english,
    movable: false, major: f.major, gregorian: iso(f.jdn), ethiopic: ethIsoOf(f.jdn),
    weekday: { ...WEEKDAYS[f.weekday] },
  }));
  const feasts = type === 'movable' ? movable : type === 'fixed' ? fixed
    : [...movable, ...fixed].sort((a, b) => a.gregorian.localeCompare(b.gregorian));
  return c.json({ ethiopicYear: year, type, count: feasts.length, feasts });
});

app.get('/v1/bahire-hasab/:year', (c) => {
  const year = parseYear(c.req.param('year'));
  const b = bahireHasab(year);
  return c.json({
    ethiopicYear: year,
    ameteAlem: b.ameteAlem,
    evangelist: b.evangelist,
    computation: {
      medeb: b.medeb, wenber: b.wenber, abekte: b.abekte, metqi: b.metqi,
      mebajaHamer: {
        ethiopic: ethIso(b.mebajaHamer.year, b.mebajaHamer.month, b.mebajaHamer.day),
        monthName: MONTHS[b.mebajaHamer.month - 1],
        weekday: { ...WEEKDAYS[b.mebajaHamer.weekday] },
      },
      tewsakApplied: b.ninevehJDN - ethiopicToJDN(b.mebajaHamer.year, b.mebajaHamer.month + 4, b.mebajaHamer.day),
    },
    newYear: {
      gregorian: iso(ethiopicToJDN(year, 1, 1)),
      weekday: { ...WEEKDAYS[b.meskeremOneWeekday] },
      isLeapYear: isEthiopicLeapYear(year),
      pagumenDays: daysInEthiopicMonth(year, 13),
    },
    movableFeasts: MOVABLE_FEASTS.map((f) => {
      const jdn = b.ninevehJDN + f.offset;
      const wd = jdnToWeekday(jdn);
      return {
        key: f.key, amharic: f.amharic, translit: f.translit, english: f.english,
        daysFromNineveh: f.offset, gregorian: iso(jdn), ethiopic: ethIsoOf(jdn),
        weekday: { ...WEEKDAYS[wd] },
      };
    }),
  });
});


// iCalendar feed: subscribe to a year's fasts/feasts in any calendar app.
app.get('/v1/calendar/ics', (c) => {
  const year = parseYear(c.req.query('year') ?? '');
  const type = (c.req.query('type') ?? 'all').toLowerCase();
  if (!['fasting', 'feasts', 'all', 'readings'].includes(type)) {
    throw new ApiError(400, `Unknown type '${type}'.`, "Use 'fasting', 'feasts', 'readings' or 'all'.");
  }
  return c.body(buildIcs(year, type as 'fasting' | 'feasts' | 'all' | 'readings'), 200, {
    'content-type': 'text/calendar; charset=utf-8',
    'content-disposition': `attachment; filename="eotc-${type}-${year}.ics"`,
  });
});

app.get('/v1/calendar/season', (c) => {
  const raw = c.req.query('date');
  if (!raw) throw new ApiError(400, "Missing 'date' query parameter.", 'e.g. ?date=2026-03-04');
  const jdn = parseDate(raw, cal(c));
  const s = seasonOf(jdn);
  return c.json({
    date: { gregorian: iso(jdn), ethiopic: ethIsoOf(jdn) },
    season: {
      key: s.key, amharic: s.amharic, translit: s.translit, english: s.english, theme: s.theme,
      start: { gregorian: iso(s.startJDN), ethiopic: ethIsoOf(s.startJDN) },
      end: { gregorian: iso(s.endJDN), ethiopic: ethIsoOf(s.endJDN) },
      days: s.endJDN - s.startJDN + 1,
      dayOfSeason: jdn - s.startJDN + 1,
    },
  });
});

app.get('/v1/calendar/geez-numeral', (c) => {
  const raw = c.req.query('number');
  if (!raw) throw new ApiError(400, "Missing 'number' query parameter.", 'e.g. ?number=2018');
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new ApiError(400, `Expected an integer, got '${raw}'.`);
  return c.json({ number: n, geez: toGeez(n) });
});

// Batch conversion for non-contiguous dates (a list of past events, say).
const BATCH_LIMIT = 366;
app.post('/v1/calendar/convert/batch', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ApiError(400, 'Body must be JSON.', '{"dates": ["2026-04-12", ...], "calendar": "gregorian"}');
  }
  const b = body as { dates?: unknown; calendar?: unknown };
  if (!Array.isArray(b.dates) || b.dates.length === 0) {
    throw new ApiError(400, "Body must have a non-empty 'dates' array.");
  }
  if (b.dates.length > BATCH_LIMIT) {
    throw new ApiError(400, `At most ${BATCH_LIMIT} dates per request, got ${b.dates.length}.`);
  }
  const calendar = typeof b.calendar === 'string' ? b.calendar.toLowerCase() : 'gregorian';
  const results = (b.dates as unknown[]).map((raw) => {
    if (typeof raw !== 'string') return { input: raw, error: 'Each date must be a string.' };
    try {
      const d = describeDay(parseDate(raw, calendar));
      return { input: raw, jdn: d.jdn, gregorian: d.gregorian, ethiopic: d.ethiopic, weekday: d.weekday };
    } catch (e) {
      return { input: raw, error: e instanceof Error ? e.message : 'Invalid date.' };
    }
  });
  return c.json({ calendar, count: results.length, results });
});

app.get('/v1/calendar/:year/:month', (c) => {
  const year = parseYear(c.req.param('year'));
  const month = Number(c.req.param('month'));
  if (!Number.isInteger(month) || month < 1 || month > 13) {
    throw new ApiError(400, `Ethiopian month must be 1-13, got '${c.req.param('month')}'.`,
      'Month 13 is Pagumen, the short month.');
  }
  const n = daysInEthiopicMonth(year, month);
  const days = Array.from({ length: n }, (_, i) => describeDay(ethiopicToJDN(year, month, i + 1)));
  return c.json({
    ethiopicYear: year, month, monthName: MONTHS[month - 1], days: n,
    startsOn: { ...WEEKDAYS[days[0].weekday.n] },
    calendar: days,
  });
});

// ---- Bible: metadata, citation parsing, and the text boundary --------------

const bookSummary = (book: NonNullable<ReturnType<typeof bibleBook>>) => ({
  id: book.id, order: book.order, slug: book.slug,
  testament: book.testament, section: book.section,
  names: book.names, chapters: book.chapters,
});

app.get('/v1/bible/books', (c) => {
  const testament = c.req.query('testament')?.toLowerCase() ?? null;
  const section = c.req.query('section')?.toLowerCase() ?? null;
  if (testament && !['old', 'new'].includes(testament)) {
    throw new ApiError(400, `Unknown testament '${testament}'.`, "Use 'old' or 'new'.");
  }
  const books = bibleBooks()
    .filter((book) => !testament || book.testament === testament)
    .filter((book) => !section || (book.section ?? '').toLowerCase() === section)
    .map(bookSummary);
  return c.json({
    versification: bibleVersification(), canonNote: bibleCanonNote(),
    count: books.length, books,
  });
});

app.get('/v1/bible/books/:id', (c) => {
  const book = bibleBook(c.req.param('id')) ?? resolveBook(c.req.param('id'))?.book ?? null;
  if (!book) throw new ApiError(404, `Unknown book '${c.req.param('id')}'.`, 'See /v1/bible/books for the canon.');
  return c.json({
    ...bookSummary(book),
    versification: bibleVersification(),
    verseCounts: book.verseCounts,
    textEditions: book.textEditions,
  });
});

app.get('/v1/bible/editions', (c) =>
  c.json({ count: bibleEditions().length, editions: bibleEditions() }));

app.get('/v1/bible/parse', (c) => {
  const q = c.req.query('q');
  if (!q || !q.trim()) throw new ApiError(400, "Missing query parameter 'q'.", 'Example: /v1/bible/parse?q=ዮሐንስ ም· ፫ ቍ ፲፮');
  const tokens = q.trim().split(/\s+/);
  let match = null, citation = null;
  // Shortest book part first, so citation numerals never get swallowed into
  // the book label; numbered book names still win because their bare prefix
  // is ambiguous until the numeral is included.
  for (let i = 1; i < tokens.length; i++) {
    const candidate = resolveBook(tokens.slice(0, i).join(' '));
    if (!candidate) continue;
    const parsed = parseCitation(tokens.slice(i).join(' '));
    if (parsed.chapter) { match = candidate; citation = parsed; break; }
    if (!match) { match = candidate; citation = parsed; }
  }
  if (!match) {
    const whole = resolveBook(q);
    if (whole) { match = whole; citation = { chapter: null, verseStart: null, verseEnd: null, toEndOfChapter: false }; }
  }
  const book = match?.book ?? null;
  const withinBounds = book && citation?.chapter
    ? citation.chapter >= 1 && citation.chapter <= book.chapters
      && (citation.verseStart === null || (citation.verseStart >= 1 && citation.verseStart <= book.verseCounts[citation.chapter - 1]))
    : null;
  return c.json({
    input: q,
    resolved: Boolean(book),
    book: book ? { id: book.id, names: book.names, matchedOn: match!.matchedOn, confidence: match!.confidence } : null,
    chapter: citation?.chapter ?? null,
    verseStart: citation?.verseStart ?? null,
    verseEnd: citation?.verseEnd ?? null,
    toEndOfChapter: citation?.toEndOfChapter ?? false,
    withinBounds,
    versification: bibleVersification(),
  });
});

app.get('/v1/bible/:edition/:book/:chapter', (c) => {
  const editionId = c.req.param('edition');
  const edition = bibleEditions().find((entry) => entry.id === editionId);
  if (!edition) {
    throw new ApiError(400, `Unknown edition '${editionId}'.`,
      `Known editions: ${bibleEditions().map((entry) => entry.id).join(', ')}.`);
  }
  const book = bibleBook(c.req.param('book')) ?? resolveBook(c.req.param('book'))?.book ?? null;
  if (!book) throw new ApiError(404, `Unknown book '${c.req.param('book')}'.`, 'See /v1/bible/books for the canon.');
  const chapter = Number(c.req.param('chapter'));
  if (!Number.isInteger(chapter) || chapter < 1) {
    throw new ApiError(400, `Chapter must be a positive integer, got '${c.req.param('chapter')}'.`);
  }
  if (chapter > book.chapters) {
    throw new ApiError(404, `${book.id} has ${book.chapters} chapters; there is no chapter ${chapter}.`);
  }
  return c.json({
    edition: { id: edition.id, title: edition.title, license: edition.license, source: edition.source },
    book: { id: book.id, names: book.names },
    chapter,
    verseCount: book.verseCounts[chapter - 1],
    verses: null,
    textAvailable: false,
    reason: 'Verse text is not bundled with the public MIT runtime; the edition is CC BY-NC-ND.',
    selfHost: 'Self-hosted Python deployments with the edition present locally can serve text; see the documentation.',
  });
});

// ---- Calendar range --------------------------------------------------------

app.get('/v1/calendar/range', (c) => {
  const start = c.req.query('start');
  const end = c.req.query('end');
  if (!start || !end) {
    throw new ApiError(400, "Both 'start' and 'end' query parameters are required.",
      'Example: /v1/calendar/range?start=2026-04-01&end=2026-04-30');
  }
  const startJDN = parseDate(start, cal(c));
  const endJDN = parseDate(end, cal(c));
  if (endJDN < startJDN) throw new ApiError(400, "'end' must not be before 'start'.");
  const count = endJDN - startJDN + 1;
  if (count > 366) {
    throw new ApiError(400, `Range covers ${count} days; the maximum is 366.`,
      'Use /v1/calendar/{year}/{month} per month, or split the range.');
  }
  return c.json({
    start: { gregorian: iso(startJDN), ethiopic: ethIsoOf(startJDN) },
    end: { gregorian: iso(endJDN), ethiopic: ethIsoOf(endJDN) },
    count,
    days: Array.from({ length: count }, (_, i) => describeDay(startJDN + i)),
  });
});

// ---- Upcoming feasts and fasts ---------------------------------------------

app.get('/v1/upcoming', (c) => {
  const days = Number(c.req.query('days') ?? 30);
  if (!Number.isInteger(days) || days < 1 || days > 30) {
    throw new ApiError(400, `'days' must be an integer from 1 to 30, got '${c.req.query('days')}'.`);
  }
  const type = (c.req.query('type') ?? 'all').toLowerCase();
  if (!['all', 'feasts', 'fasts'].includes(type)) {
    throw new ApiError(400, `Unknown type '${type}'.`, "Use 'all', 'feasts' or 'fasts'.");
  }
  const fromParam = c.req.query('from');
  let startJDN: number;
  if (fromParam) {
    startJDN = parseDate(fromParam, cal(c));
  } else {
    const tz = c.req.query('tz') ?? 'Africa/Addis_Ababa';
    let parts: Intl.DateTimeFormatPart[];
    try {
      parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(new Date());
    } catch {
      throw new ApiError(400, `Unknown timezone '${tz}'.`, 'Use an IANA name, e.g. Africa/Addis_Ababa.');
    }
    const g = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    startJDN = gregorianToJDN(Number(g.year), Number(g.month), Number(g.day));
  }
  const endJDN = startJDN + days - 1;

  type UpcomingItem = {
    daysAway: number; kind: string;
    gregorian: string; ethiopic: string;
    feast?: Record<string, unknown>; fast?: Record<string, unknown>;
  };
  const items: UpcomingItem[] = [];
  if (type !== 'fasts') {
    for (let offset = 0; offset < days; offset++) {
      const jdn = startJDN + offset;
      for (const feast of describeDay(jdn).feasts) {
        items.push({
          daysAway: offset, kind: 'feast',
          gregorian: iso(jdn), ethiopic: ethIsoOf(jdn),
          feast,
        });
      }
    }
  }
  if (type !== 'feasts') {
    const startYear = jdnToEthiopic(startJDN).year;
    const endYear = jdnToEthiopic(endJDN).year;
    for (let year = startYear; year <= endYear + 1; year++) {
      for (const period of fastPeriods(year)) {
        for (const [kind, jdn] of [['fast_begins', period.startJDN], ['fast_ends', period.endJDN]] as const) {
          if (jdn < startJDN || jdn > endJDN) continue;
          items.push({
            daysAway: jdn - startJDN, kind,
            gregorian: iso(jdn), ethiopic: ethIsoOf(jdn),
            fast: {
              key: period.key, amharic: period.amharic, translit: period.translit,
              english: period.english, movable: period.movable, days: period.days,
            },
          });
        }
      }
    }
  }
  items.sort((a, b) => a.daysAway - b.daysAway
    || a.kind.localeCompare(b.kind)
    || String((a.feast ?? a.fast)?.key ?? '').localeCompare(String((b.feast ?? b.fast)?.key ?? '')));
  return c.json({
    from: { gregorian: iso(startJDN), ethiopic: ethIsoOf(startJDN) },
    days, type, count: items.length, items,
  });
});

// ---- Feast lookup and search -----------------------------------------------

const resolveFeastForYear = (definition: NonNullable<ReturnType<typeof feastByKey>>, year: number) => {
  const movable = movableFeasts(year).find((feast) => feast.key === definition.key);
  const jdn = movable ? movable.jdn
    : fixedFeasts(year).find((feast) => feast.key === definition.key)!.jdn;
  return {
    gregorian: iso(jdn), ethiopic: ethIsoOf(jdn),
    weekday: { ...WEEKDAYS[jdnToWeekday(jdn)] },
  };
};

app.get('/v1/feasts/:year/:key', (c) => {
  const year = parseYear(c.req.param('year'));
  const definition = feastByKey(c.req.param('key'));
  if (!definition) {
    throw new ApiError(404, `Unknown feast '${c.req.param('key')}'.`,
      'Use a feast key, name, or alias; /v1/feasts/search?q= finds them.');
  }
  return c.json({
    ethiopicYear: year,
    key: definition.key,
    amharic: definition.amharic,
    translit: definition.translit,
    english: definition.english,
    movable: definition.movable,
    major: definition.major,
    aliases: definition.aliases,
    date: resolveFeastForYear(definition, year),
  });
});

app.notFound((c) =>
  c.json({ error: 'not_found', message: `No route for ${c.req.method} ${new URL(c.req.url).pathname}.`, hint: 'See / for the endpoint list.' }, 404));

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json({ error: err.status === 400 ? 'bad_request' : 'not_found', message: err.message, ...(err.hint ? { hint: err.hint } : {}) }, err.status);
  }
  if (err instanceof RangeError) return c.json({ error: 'bad_request', message: err.message }, 400);
  console.error(err);
  return c.json({ error: 'internal', message: 'Unexpected error.' }, 500);
});

export default app;
