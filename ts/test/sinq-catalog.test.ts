/**
 * Integrity invariants for the generated Sinq catalog. The Python suite
 * asserts the same invariants against the same artifact, so a regeneration
 * that breaks structure, referential integrity, or the license boundary
 * fails both builds.
 */
import { describe, it, expect } from 'vitest';

import {
  sinqCatalog, sinqDailyOn, sinqSeasonal, sinqMonthly,
  sinqFeasts, sinqSubFeasts, sinqMahlets,
} from '../src/core/sinq.ts';

const SLOTS = ['psalm', 'gospel', 'paulineEpistle', 'catholicEpistle', 'acts'];
const SERVICES = ['matins', 'liturgy', 'vespers'];

function allServices() {
  const catalog = sinqCatalog();
  const entries = [
    ...Object.values(catalog.daily),
    ...catalog.seasonal,
    ...catalog.monthly,
  ];
  return entries.flatMap((entry) => Object.entries(entry.services));
}

describe('sinq catalog', () => {
  it('has the expected collection counts', () => {
    const catalog = sinqCatalog();
    expect(Object.keys(catalog.daily)).toHaveLength(366);
    expect(catalog.seasonal).toHaveLength(43);
    expect(catalog.monthly).toHaveLength(9);
    expect(catalog.feasts).toHaveLength(21);
    expect(catalog.subFeasts).toHaveLength(40);
    expect(catalog.mahlets).toHaveLength(37);
  });

  it('covers every possible Ethiopian month-day exactly once', () => {
    for (let month = 1; month <= 13; month++) {
      const days = month === 13 ? 6 : 30;
      for (let day = 1; day <= days; day++) {
        const entry = sinqDailyOn(month, day);
        expect(entry, `${month}-${day}`).not.toBeNull();
        expect(entry!.ethiopianMonth).toBe(month);
        expect(entry!.ethiopianDay).toBe(day);
      }
      expect(sinqDailyOn(month, days + 1)).toBeNull();
    }
  });

  it('uses unique ids in every collection', () => {
    const catalog = sinqCatalog();
    for (const collection of [
      Object.values(catalog.daily), catalog.seasonal, catalog.monthly,
      catalog.feasts, catalog.subFeasts, catalog.mahlets,
    ]) {
      const ids = collection.map((entry) => entry.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('keeps the feast graph referentially intact', () => {
    const feastIds = new Set(sinqFeasts().map((feast) => feast.id));
    for (const sub of sinqSubFeasts()) expect(feastIds, sub.id).toContain(sub.feast);
    const subFeastIds = new Set(sinqSubFeasts().map((sub) => sub.id));
    for (const mahlet of sinqMahlets()) expect(subFeastIds, mahlet.id).toContain(mahlet.subFeast);
  });

  it('links fixed feasts to real dates and movable feasts to none', () => {
    for (const feast of sinqFeasts()) {
      if (feast.movable) {
        expect(feast.dateKey).toBeNull();
      } else {
        expect(feast.dateKey).toBe(`${feast.monthNum}-${feast.day}`);
        expect(sinqDailyOn(feast.monthNum!, feast.day!)).not.toBeNull();
      }
    }
  });

  it('uses only known services and slots', () => {
    for (const [name, service] of allServices()) {
      expect(SERVICES).toContain(name);
      for (const slot of Object.keys(service.readings)) expect(SLOTS).toContain(slot);
      for (const [slot, readings] of Object.entries(service.readings)) {
        for (const reading of readings) expect(reading.slot).toBe(slot);
      }
    }
  });

  it('honors the license boundary: references and flags, never text bodies', () => {
    for (const [, service] of allServices()) {
      for (const readings of Object.values(service.readings)) {
        for (const reading of readings) {
          expect(reading).not.toHaveProperty('text');
          expect(Object.values(reading.textAvailable).every((flag) => typeof flag === 'boolean')).toBe(true);
        }
      }
    }
    for (const mahlet of sinqMahlets()) {
      for (const chant of mahlet.chants) {
        expect(Object.keys(chant)).toEqual(['role']);
      }
    }
  });

  it('matches every monthly rule to Sundays with a usable span', () => {
    for (const entry of sinqMonthly()) {
      expect(entry.match.appliesTo).toBe('sunday');
      expect(entry.match.nthSunday !== null || entry.match.fromDay !== null).toBe(true);
    }
  });

  it('classifies seasonal entries under known seasons with stable keys', () => {
    for (const entry of sinqSeasonal()) {
      expect(entry.id).toBe(
        `seasonal:${entry.season}:${entry.week ?? 0}${entry.part != null ? `:${entry.part}` : ''}`,
      );
      expect(entry.sourceKey.length).toBeGreaterThan(0);
    }
  });
});
