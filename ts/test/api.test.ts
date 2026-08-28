/** HTTP behaviour of the Hono app: shapes, errors, and known dates. */
import { describe, it, expect } from 'vitest';
import app from '../src/index.ts';

const get = async (path: string) => {
  const res = await app.request(`http://localhost${path}`);
  return { status: res.status, body: await res.json() as any, headers: res.headers };
};

describe('index and health', () => {
  it('serves an endpoint listing at the root', async () => {
    const { status, body } = await get('/');
    expect(status).toBe(200);
    expect(body.name).toBe('EOTCDev API');
    expect(Object.keys(body.endpoints).length).toBeGreaterThan(5);
  });

  it('reports health', async () => {
    expect((await get('/v1/health')).body.status).toBe('ok');
  });
});

describe('date description', () => {
  it('describes Fasika 2026 correctly', async () => {
    const { body } = await get('/v1/date/2026-04-12');
    expect(body.ethiopic.date).toBe('2018-08-04');
    expect(body.ethiopic.monthName.translit).toBe('Miyazya');
    expect(body.weekday.english).toBe('Sunday');
    expect(body.fasting.isFasting).toBe(false);
    expect(body.feasts.map((f: any) => f.key)).toContain('fasika');
  });

  it('accepts Ethiopian input', async () => {
    const { body } = await get('/v1/date/2018-08-04?calendar=ethiopian');
    expect(body.gregorian.date).toBe('2026-04-12');
  });

  it('round-trips both directions', async () => {
    const a = (await get('/v1/convert/2026-08-27')).body;
    const b = (await get(`/v1/convert/${a.ethiopic.date}?calendar=ethiopian`)).body;
    expect(b.gregorian.date).toBe('2026-08-27');
    expect(a.jdn).toBe(b.jdn);
  });

  it('handles Pagumen', async () => {
    const { body } = await get('/v1/date/2015-13-06?calendar=ethiopian');
    expect(body.ethiopic.monthName.translit).toBe('Pagumen');
    expect(body.ethiopic.isLeapYear).toBe(true);
    expect(body.gregorian.date).toBe('2023-09-11');
  });
});

describe('fasting', () => {
  it('reports a Lenten weekday as fasting', async () => {
    const { body } = await get('/v1/fasting/2026-03-04');
    expect(body.isFasting).toBe(true);
    expect(body.periods[0].key).toBe('abiy_tsome');
    expect(body.periods[0].dayOfPeriod).toBeGreaterThan(0);
  });

  it('lifts the weekly fast on Gena', async () => {
    const { body } = await get('/v1/fasting/2026-01-07');
    expect(body.weekday.english).toBe('Wednesday');
    expect(body.isFasting).toBe(false);
    expect(body.feastOverride).toBe(true);
  });

  it('lifts the weekly fast during the fifty days', async () => {
    const { body } = await get('/v1/fasting/2026-04-15');
    expect(body.weekday.english).toBe('Wednesday');
    expect(body.fastFreeSeason).toBe(true);
    expect(body.isFasting).toBe(false);
  });

  it('keeps an ordinary Wednesday fast', async () => {
    const { body } = await get('/v1/fasting/2026-09-16');
    expect(body.isFasting).toBe(true);
    expect(body.weeklyFast).toBe(true);
  });
});

describe('Gitsawe content and links', () => {
  it('joins fixed Gitsawe, Sinksar summaries, and Bible references', async () => {
    const { status, body } = await get('/v1/gitsawe/2018-12-22?calendar=ethiopian');
    expect(status).toBe(200);
    expect(body.date.ethiopic).toBe('2018-12-22');
    expect(body.resolution).toBe('fixed_candidate_only');
    expect(body.gitsawe.services.liturgy.epistlesAndActs).toHaveLength(3);
    expect(body.gitsawe.services.liturgy.gospels[0].bibleBook).toBeTruthy();
    expect(body.sinksar.entryCount).toBeGreaterThan(0);
    expect(body.sinksar.fullTextAvailable).toBe(false);
    expect(body.bible.textIncluded).toBe(false);
  });

  it('returns a focused daily readings response without Sinksar content', async () => {
    const { status, body } = await get('/v1/readings/2018-12-22?calendar=ethiopian');
    expect(status).toBe(200);
    expect(body.date.ethiopic).toBe('2018-12-22');
    expect(body.source.resolution).toBe('fixed_candidate_only');
    expect(body.services.liturgy.epistles).toHaveLength(2);
    expect(body.services.liturgy.acts).toHaveLength(1);
    expect(body.services.liturgy.gospels[0].canonicalReference.book).toBeTruthy();
    expect(body.bible.textIncluded).toBe(false);
    expect(body.sinksar).toBeUndefined();
  });

  it('flags Fasika Sunday as requiring unresolved precedence', async () => {
    const { body } = await get('/v1/gitsawe/2026-04-12');
    expect(body.resolutionFactors.isSunday).toBe(true);
    expect(body.resolutionFactors.movableFeasts).toContain('fasika');
    expect(body.resolutionFactors.knownPrecedenceConflict).toBe(true);
    expect(body.coverage.movableCycle).toBe('not_transcribed');
    expect(body.coverage.sundayCycle).toBe('not_transcribed');
  });

  it('exposes annual and monthly Sinksar feast lists', async () => {
    const { body } = await get('/v1/gitsawe/2018-08-04?calendar=ethiopian');
    expect(body.sinksar.annualFeasts.sourceEntryId).toBe('8-4-4');
    expect(body.sinksar.annualFeasts.heading).toContain('ዓመታዊ');
    expect(body.sinksar.annualFeasts.items).toHaveLength(4);
    expect(body.sinksar.annualFeasts.items[0].title).toContain('ቅዱስ መርቄ');
    expect(body.sinksar.monthlyFeasts.heading).toContain('ወርኀዊ በዓላት');
    expect(body.sinksar.monthlyFeasts.items).toHaveLength(6);
    expect(body.sinksar.monthlyFeasts.items[0].title).toContain('ማርያም');
  });

  it('uses Gospel field context to distinguish John from 1 John', async () => {
    const { body } = await get('/v1/readings/2018-01-04?calendar=ethiopian');
    expect(body.services.liturgy.gospels[0].sourceBook).toBe('ዮሐንስ');
    expect(body.services.liturgy.gospels[0].bibleBook).toBe('JHN');
    expect(body.services.liturgy.gospels[0].canonicalReference.book).toBe('JHN');
  });
});

describe('year endpoints', () => {
  it('lists fasting periods', async () => {
    const { body } = await get('/v1/fasts/2018');
    expect(body.periods).toHaveLength(7);
    const lent = body.periods.find((p: any) => p.key === 'abiy_tsome');
    expect(lent.days).toBe(55);
    expect(lent.end.gregorian).toBe('2026-04-11');
  });

  it('lists feasts and filters by type', async () => {
    const all = (await get('/v1/feasts/2018')).body;
    const mov = (await get('/v1/feasts/2018?type=movable')).body;
    const fix = (await get('/v1/feasts/2018?type=fixed')).body;
    expect(all.count).toBe(mov.count + fix.count);
    expect(mov.feasts.every((f: any) => f.movable)).toBe(true);
  });

  it('exposes the bahire hasab chain', async () => {
    const { body } = await get('/v1/bahire-hasab/2018');
    expect(body.ameteAlem).toBe(7518);
    expect(body.evangelist.translit).toBe('Marqos');
    expect(body.computation.metqi).toBe(18);
    expect(body.computation.abekte).toBe(12);
    expect(body.movableFeasts.find((f: any) => f.key === 'fasika').gregorian).toBe('2026-04-12');
  });

  it('renders a month, including Pagumen', async () => {
    expect((await get('/v1/calendar/2018/1')).body.calendar).toHaveLength(30);
    expect((await get('/v1/calendar/2018/13')).body.days).toBe(5);
    expect((await get('/v1/calendar/2015/13')).body.days).toBe(6);
  });
});

describe('errors', () => {
  it('rejects malformed dates', async () => {
    const { status, body } = await get('/v1/date/not-a-date');
    expect(status).toBe(400);
    expect(body.error).toBe('bad_request');
    expect(body.hint).toBeTruthy();
  });

  it('rejects dates that do not exist', async () => {
    expect((await get('/v1/date/2026-02-31')).status).toBe(400);
  });

  it('rejects Pagumen 6 in a common year', async () => {
    const { status, body } = await get('/v1/date/2018-13-06?calendar=ethiopian');
    expect(status).toBe(400);
    expect(body.message).toContain('5 days');
  });

  it('rejects a bad month and a bad year', async () => {
    expect((await get('/v1/calendar/2018/14')).status).toBe(400);
    expect((await get('/v1/fasts/abc')).status).toBe(400);
  });

  it('404s unknown routes with a hint', async () => {
    const { status, body } = await get('/v1/nope');
    expect(status).toBe(404);
    expect(body.hint).toBeTruthy();
  });
});

describe('headers', () => {
  it('sets CORS and caching', async () => {
    const { headers } = await get('/v1/date/2026-04-12');
    expect(headers.get('access-control-allow-origin')).toBe('*');
    expect(headers.get('cache-control')).toContain('max-age');
  });

  it('does not cache clock-dependent routes for a full day', async () => {
    expect((await get('/v1/today')).headers.get('cache-control')).toBe('public, max-age=60, must-revalidate');
    expect((await get('/v1/upcoming?days=5')).headers.get('cache-control')).toBe('public, max-age=60, must-revalidate');
    expect((await get('/v1/upcoming?from=2026-04-01&days=5')).headers.get('cache-control')).toBe('public, max-age=86400');
    expect((await get('/v1/health')).headers.get('cache-control')).toBe('no-store');
  });

  it('limits upcoming queries to a 30-day horizon', async () => {
    expect((await get('/v1/upcoming?from=2026-04-01&days=30')).status).toBe(200);
    const tooLong = await get('/v1/upcoming?from=2026-04-01&days=31');
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.message).toContain('1 to 30');
  });

  it('allows POST in CORS preflight', async () => {
    const res = await app.request('http://localhost/v1/calendar/convert/batch', {
      method: 'OPTIONS',
      headers: { origin: 'https://example.com', 'access-control-request-method': 'POST' },
    });
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('returns the public 429 contract when the platform limiter denies a request', async () => {
    const res = await app.request('http://localhost/v1/date/2026-04-12', {}, {
      API_RATE_LIMITER: { limit: async () => ({ success: false }) },
    });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
    expect(await res.json()).toEqual({
      error: 'rate_limited',
      message: 'Too many requests. Please retry after 60 seconds.',
      retryAfter: 60,
    });
  });
});
