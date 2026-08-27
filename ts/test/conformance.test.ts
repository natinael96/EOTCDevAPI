/**
 * Asserts the TypeScript implementation reproduces spec/conformance.json.
 * The Python suite asserts the same fixture, so drift between the two
 * implementations fails a build instead of shipping silently.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  jdnToEthiopic, jdnToGregorian, jdnToWeekday, ethiopicToJDN,
  isEthiopicLeapYear, daysInEthiopicMonth,
} from '../src/core/ethiopic.ts';
import { bahireHasab, movableFeasts, alexandrianEasterJDN } from '../src/core/bahirehasab.ts';
import { fastPeriods, fastingStatus, fastingDayCount } from '../src/core/fasts.ts';
import { fixedFeasts, commemorationsOn, fixedFeastsOn } from '../src/core/feasts.ts';
import { toGeez, fromGeez } from '../src/core/geez.ts';
import { seasonOf } from '../src/core/seasons.ts';

const cases = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../spec/conformance.json'), 'utf-8'),
).cases;

describe('conformance fixture', () => {
  it('conversion', () => {
    for (const c of cases.conversion) {
      const g = jdnToGregorian(c.jdn), e = jdnToEthiopic(c.jdn);
      expect([g.year, g.month, g.day], `gregorian jdn=${c.jdn}`).toEqual(c.gregorian);
      expect([e.year, e.month, e.day], `ethiopic jdn=${c.jdn}`).toEqual(c.ethiopic);
      expect(jdnToWeekday(c.jdn), `weekday jdn=${c.jdn}`).toBe(c.weekday);
    }
  });

  it('year shape', () => {
    for (const c of cases.year_shape) {
      expect(isEthiopicLeapYear(c.year)).toBe(c.leap);
      expect(daysInEthiopicMonth(c.year, 13)).toBe(c.pagumen);
      expect(ethiopicToJDN(c.year, 1, 1)).toBe(c.newYearJDN);
    }
  });

  it('bahire hasab', () => {
    for (const c of cases.bahire_hasab) {
      const b = bahireHasab(c.year);
      expect(b.ameteAlem).toBe(c.ameteAlem);
      expect(b.evangelist.translit).toBe(c.evangelist);
      expect([b.medeb, b.wenber, b.abekte, b.metqi]).toEqual([c.medeb, c.wenber, c.abekte, c.metqi]);
      expect([b.mebajaHamer.month, b.mebajaHamer.day, b.mebajaHamer.weekday]).toEqual(c.mebajaHamer);
      expect(b.ninevehJDN, `nineveh EC ${c.year}`).toBe(c.ninevehJDN);
    }
  });

  it('bahire hasab agrees with the Alexandrian computus', () => {
    for (const c of cases.bahire_hasab) {
      expect(c.ninevehJDN + 69, `Fasika EC ${c.year}`).toBe(c.alexandrianEasterJDN);
      expect(alexandrianEasterJDN(c.year + 8)).toBe(c.alexandrianEasterJDN);
    }
  });

  it('movable feasts', () => {
    for (const c of cases.movable_feasts)
      expect(movableFeasts(c.year).map((f) => [f.key, f.jdn, f.weekday])).toEqual(c.feasts);
  });

  it('fast periods', () => {
    for (const c of cases.fast_periods)
      expect(fastPeriods(c.year).map((p) => [p.key, p.startJDN, p.endJDN, p.days, p.movable])).toEqual(c.periods);
  });

  it('fasting status', () => {
    for (const c of cases.fasting_status) {
      const s = fastingStatus(c.jdn, c.ethiopic[0]);
      const where = `${c.ethiopic.join('-')} jdn=${c.jdn}`;
      expect(s.isFasting, where).toBe(c.isFasting);
      expect(s.weeklyFast, where).toBe(c.weeklyFast);
      expect(s.fastFreeSeason, where).toBe(c.fastFreeSeason);
      expect(s.feastOverride, where).toBe(c.feastOverride);
      expect(s.periods.map((p) => p.key), where).toEqual(c.periodKeys);
    }
  });

  it('fasting day counts', () => {
    for (const c of cases.fasting_day_count) expect(fastingDayCount(c.year)).toBe(c.count);
  });

  it('fixed feasts', () => {
    for (const c of cases.fixed_feasts)
      expect(fixedFeasts(c.year).map((f) => [f.key, f.jdn, f.weekday])).toEqual(c.feasts);
  });

  it("ge'ez numerals round-trip", () => {
    for (const c of cases.geez) {
      expect(toGeez(c.n), `geez ${c.n}`).toBe(c.geez);
      expect(fromGeez(c.geez), `geez round-trip ${c.n}`).toBe(c.n);
    }
  });

  it('seasons', () => {
    for (const c of cases.seasons) {
      const s = seasonOf(c.jdn);
      expect([s.key, s.theme, s.startJDN, s.endJDN], `season jdn=${c.jdn}`).toEqual(
        [c.key, c.theme, c.startJDN, c.endJDN]);
    }
  });

  it('commemorations', () => {
    for (const c of cases.commemorations) {
      expect(commemorationsOn({ year: 2018, month: 6, day: c.day }).map((x) => x.translit)).toEqual(c.monthly);
      expect(fixedFeastsOn({ year: 2018, month: 9, day: c.day }).map((f) => f.key)).toEqual(c.fixedOnGinbot);
    }
  });
});
