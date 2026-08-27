/**
 * Generates spec/conformance.json -- the shared contract that both the
 * TypeScript and Python implementations must reproduce exactly.
 *
 * Run: node --experimental-strip-types ts/scripts/gen-conformance.ts
 *
 * The fixture is generated from one implementation and asserted by both. If the
 * two ever drift, one of the two test suites fails immediately.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  ethiopicToJDN, jdnToEthiopic, gregorianToJDN, jdnToGregorian,
  jdnToWeekday, daysInEthiopicMonth, isEthiopicLeapYear,
} from '../src/core/ethiopic.ts';
import { bahireHasab, movableFeasts, alexandrianEasterJDN } from '../src/core/bahirehasab.ts';
import { fastPeriods, fastingStatus, fastingDayCount } from '../src/core/fasts.ts';
import { fixedFeasts, commemorationsOn, fixedFeastsOn } from '../src/core/feasts.ts';
import { toGeez } from '../src/core/geez.ts';
import { seasonOf } from '../src/core/seasons.ts';

const out: any = { version: 1, generated_by: 'ts/scripts/gen-conformance.ts', cases: {} };

// 1. Conversion: every 37th day across five centuries. A prime stride, so the
//    sample never syncs with the 4-year leap cycle or the 7-day week.
out.cases.conversion = [];
for (let jdn = gregorianToJDN(1700, 1, 1); jdn <= gregorianToJDN(2200, 1, 1); jdn += 37) {
  const g = jdnToGregorian(jdn), e = jdnToEthiopic(jdn);
  out.cases.conversion.push({
    jdn, gregorian: [g.year, g.month, g.day], ethiopic: [e.year, e.month, e.day],
    weekday: jdnToWeekday(jdn),
  });
}

// 2. Year shape
out.cases.year_shape = [];
for (let y = 1800; y <= 2200; y++) {
  out.cases.year_shape.push({
    year: y, leap: isEthiopicLeapYear(y), pagumen: daysInEthiopicMonth(y, 13),
    newYearJDN: ethiopicToJDN(y, 1, 1),
  });
}

// 3. Bahire Hasab across four centuries, with the independent computus alongside
out.cases.bahire_hasab = [];
for (let y = 1800; y <= 2200; y++) {
  const b = bahireHasab(y);
  out.cases.bahire_hasab.push({
    year: y, ameteAlem: b.ameteAlem, evangelist: b.evangelist.translit,
    medeb: b.medeb, wenber: b.wenber, abekte: b.abekte, metqi: b.metqi,
    mebajaHamer: [b.mebajaHamer.month, b.mebajaHamer.day, b.mebajaHamer.weekday],
    ninevehJDN: b.ninevehJDN,
    alexandrianEasterJDN: alexandrianEasterJDN(y + 8),
  });
}

// 4. Movable feasts
out.cases.movable_feasts = [];
for (let y = 1900; y <= 2100; y++) {
  out.cases.movable_feasts.push({ year: y, feasts: movableFeasts(y).map((f) => [f.key, f.jdn, f.weekday]) });
}

// 5. Fast periods
out.cases.fast_periods = [];
for (let y = 1900; y <= 2100; y++) {
  out.cases.fast_periods.push({
    year: y, periods: fastPeriods(y).map((p) => [p.key, p.startJDN, p.endJDN, p.days, p.movable]),
  });
}

// 6. Fasting status: every single day of eight consecutive years
out.cases.fasting_status = [];
for (let y = 2014; y <= 2021; y++) {
  for (let m = 1; m <= 13; m++) {
    for (let d = 1; d <= daysInEthiopicMonth(y, m); d++) {
      const jdn = ethiopicToJDN(y, m, d);
      const s = fastingStatus(jdn, y);
      out.cases.fasting_status.push({
        jdn, ethiopic: [y, m, d], isFasting: s.isFasting, weeklyFast: s.weeklyFast,
        fastFreeSeason: s.fastFreeSeason, feastOverride: s.feastOverride,
        periodKeys: s.periods.map((p) => p.key),
      });
    }
  }
}

// 7. Annual fasting totals
out.cases.fasting_day_count = [];
for (let y = 2000; y <= 2040; y++) out.cases.fasting_day_count.push({ year: y, count: fastingDayCount(y) });

// 8. Fixed feasts and monthly commemorations
out.cases.fixed_feasts = [];
for (let y = 2010; y <= 2030; y++) {
  out.cases.fixed_feasts.push({ year: y, feasts: fixedFeasts(y).map((f) => [f.key, f.jdn, f.weekday]) });
}
out.cases.commemorations = [];
for (let d = 1; d <= 30; d++) {
  out.cases.commemorations.push({
    day: d,
    monthly: commemorationsOn({ year: 2018, month: 6, day: d }).map((c) => c.translit),
    fixedOnGinbot: fixedFeastsOn({ year: 2018, month: 9, day: d }).map((f) => f.key),
  });
}

// 9. Ge'ez numerals: 1-3000 exhaustively, then a prime stride into the range cap
out.cases.geez = [];
for (let n = 1; n <= 3000; n++) out.cases.geez.push({ n, geez: toGeez(n) });
for (let n = 3001; n <= 999_999_999; n = n * 7 + 13) out.cases.geez.push({ n, geez: toGeez(n) });

// 10. Season of every 3rd day across 12 years (prime-ish stride over cycles)
out.cases.seasons = [];
for (let jdn = ethiopicToJDN(2010, 1, 1); jdn <= ethiopicToJDN(2022, 1, 1); jdn += 3) {
  const s = seasonOf(jdn);
  out.cases.seasons.push({ jdn, key: s.key, theme: s.theme, startJDN: s.startJDN, endJDN: s.endJDN });
}

const target = resolve(import.meta.dirname, '../../spec/conformance.json');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${target}`);
console.log('cases: ' + Object.entries(out.cases).map(([k, v]: any) => `${k}=${v.length}`).join('  '));
console.log('total vectors: ' + Object.values(out.cases).reduce((a: any, v: any) => a + v.length, 0));
