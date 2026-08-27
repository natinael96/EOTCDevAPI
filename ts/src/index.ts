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
import { fixedGitsaweOn, gitsaweCoverage } from './core/gitsawe.ts';
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
  const client = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? 'anonymous';
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

// Cache aggressively: for any given date the answer never changes.
app.use('/v1/*', async (c, next) => {
  await next();
  if (c.res.status === 200) c.res.headers.set('cache-control', 'public, max-age=86400');
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
    documentation: '/v1/openapi.json',
    note: 'All Ethiopian years are Amete Mihret. Dates are YYYY-MM-DD. No auth, no rate limit, no key.',
    endpoints: {
      'GET /v1/health': 'Liveness check.',
      'GET /v1/today': "Today, fully described. ?tz=Africa/Addis_Ababa",
      'GET /v1/date/{date}': 'Describe any date. ?calendar=gregorian|ethiopian',
      'GET /v1/convert/{date}': 'Convert between calendars. ?calendar=gregorian|ethiopian',
      'GET /v1/fasting/{date}': 'Is it a fasting day, and why. ?calendar=gregorian|ethiopian',
      'GET /v1/fasts/{year}': 'All fasting periods of an Ethiopian year.',
      'GET /v1/feasts/{year}': 'All feasts. ?type=all|movable|fixed',
      'GET /v1/bahire-hasab/{year}': 'The full ባሕረ ሐሳብ computation.',
      'GET /v1/calendar/{year}/{month}': 'One Ethiopian month, day by day.',
      'GET /v1/calendar/ics': 'iCalendar feed. ?year=2018&type=fasting|feasts|all',
      'GET /v1/calendar/season': 'Liturgical season of a date. ?date=&calendar=',
      'GET /v1/calendar/geez-numeral': "Arabic to Ge'ez numerals. ?number=2018",
      'GET /v1/gitsawe/{date}': 'Fixed-cycle Gitsawe with Sinksar and canonical Bible links.',
      'GET /v1/readings/{date}': 'Daily Psalms, Gospels, Epistles and Acts from the Gitsawe.',
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

app.get('/v1/today', (c) => {
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
  const jdn = gregorianToJDN(Number(g.year), Number(g.month), Number(g.day));
  return c.json({ timezone: tz, ...describeDay(jdn) });
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

app.get('/v1/readings/:date', (c) => {
  const jdn = parseDate(c.req.param('date'), cal(c));
  const described = describeDay(jdn);
  const fixed = fixedGitsaweOn(described.ethiopic.month, described.ethiopic.day);
  if (!fixed) throw new ApiError(404, 'No fixed-cycle Gitsawe record for this date.');
  const gitsawe = fixed.gitsawe as { cycle: string; services: Record<string, any> };
  const services = Object.fromEntries(Object.entries(gitsawe.services).map(([name, service]) => [name, {
    psalms: service.psalms ?? [],
    gospels: service.gospels ?? [],
    epistles: (service.epistlesAndActs ?? []).filter((reading: any) => reading.bibleBook !== 'ACT'),
    acts: (service.epistlesAndActs ?? []).filter((reading: any) => reading.bibleBook === 'ACT'),
    anaphora: service.anaphora ?? null,
  }]));
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
  if (!['fasting', 'feasts', 'all'].includes(type)) {
    throw new ApiError(400, `Unknown type '${type}'.`, "Use 'fasting', 'feasts' or 'all'.");
  }
  return c.body(buildIcs(year, type as 'fasting' | 'feasts' | 'all'), 200, {
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
