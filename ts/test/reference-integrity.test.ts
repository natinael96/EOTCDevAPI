/**
 * Every canonical Bible reference the API publishes must name a chapter and
 * verse that the canon actually contains. A citation can parse cleanly and
 * still be unresolvable — a misread Ge'ez numeral, a mis-assigned book label,
 * or a psalter numbering that was never converted — and the result is a
 * reference that resolves to nothing for every consumer.
 *
 * The compilers narrow such references to the part that verifies and record
 * the original in the quality reports, so this invariant holding is what
 * proves the narrowing ran. The Python suite asserts the same invariant
 * against the same artifacts.
 */
import { describe, it, expect } from 'vitest';

import { bibleBooks } from '../src/core/bible.ts';
import gitsaweCatalogJson from '../../py/eotc/gitsawe_catalog.js';
import { sinqCatalog } from '../src/core/sinq.ts';

const verseCounts = new Map(bibleBooks().map((book) => [book.id, book.verseCounts]));

type Reference = {
  book?: string; bibleBook?: string;
  chapter: number | null; verseStart: number | null; verseEnd: number | null;
};

/** The reason a reference cannot resolve, or null when it is in range. */
function outOfRange(ref: Reference): string | null {
  const book = ref.book ?? ref.bibleBook;
  const counts = book ? verseCounts.get(book) : undefined;
  if (!counts || !ref.chapter) return null;
  if (ref.chapter > counts.length) {
    return `${book} has ${counts.length} chapters, reference names ${ref.chapter}`;
  }
  const verses = counts[ref.chapter - 1];
  if (ref.verseStart && ref.verseStart > verses) {
    return `${book} ${ref.chapter} has ${verses} verses, reference starts at ${ref.verseStart}`;
  }
  if (ref.verseEnd && ref.verseEnd > verses) {
    return `${book} ${ref.chapter} has ${verses} verses, reference ends at ${ref.verseEnd}`;
  }
  return null;
}

const catalog = gitsaweCatalogJson as {
  days: Record<string, { gitsawe: { services: Record<string, Record<string, any>> } }>;
};

function gitsaweReferences(): { where: string; ref: Reference }[] {
  const found: { where: string; ref: Reference }[] = [];
  for (const [key, day] of Object.entries(catalog.days)) {
    for (const [service, block] of Object.entries(day.gitsawe.services)) {
      for (const group of ['psalms', 'gospels', 'epistlesAndActs']) {
        for (const reading of (block[group] ?? []) as { canonicalReference: Reference | null }[]) {
          if (reading.canonicalReference) {
            found.push({ where: `${key} ${service} ${group}`, ref: reading.canonicalReference });
          }
        }
      }
    }
  }
  return found;
}

function sinqReferences(): { where: string; ref: Reference }[] {
  const cat = sinqCatalog();
  const entries = [
    ...Object.entries(cat.daily).map(([key, entry]) => [`daily ${key}`, entry] as const),
    ...cat.seasonal.map((entry, i) => [`seasonal ${i}`, entry] as const),
    ...cat.monthly.map((entry, i) => [`monthly ${i}`, entry] as const),
  ];
  const found: { where: string; ref: Reference }[] = [];
  for (const [label, entry] of entries) {
    for (const [service, block] of Object.entries(entry.services)) {
      for (const [slot, readings] of Object.entries(block.readings)) {
        for (const reading of readings as { reference: Reference }[]) {
          if (reading.reference.chapter) {
            found.push({ where: `${label} ${service} ${slot}`, ref: reading.reference });
          }
        }
      }
    }
  }
  return found;
}

describe('canonical reference integrity', () => {
  it('finds references to check in both catalogs', () => {
    expect(gitsaweReferences().length).toBeGreaterThan(3000);
    expect(sinqReferences().length).toBeGreaterThan(3000);
  });

  it('every Gitsawe reference names a chapter and verse that exist', () => {
    const broken = gitsaweReferences()
      .map(({ where, ref }) => ({ where, why: outOfRange(ref) }))
      .filter((entry) => entry.why)
      .map((entry) => `${entry.where}: ${entry.why}`);
    expect(broken).toEqual([]);
  });

  it('every Sinq reference names a chapter and verse that exist', () => {
    const broken = sinqReferences()
      .map(({ where, ref }) => ({ where, why: outOfRange(ref) }))
      .filter((entry) => entry.why)
      .map((entry) => `${entry.where}: ${entry.why}`);
    expect(broken).toEqual([]);
  });

  // The Ge'ez psalter runs a chapter behind the Hebrew numbering the editions
  // use, so an unconverted psalm citation lands on the wrong psalm while still
  // being in range. These are the anchors that pin the conversion itself.
  it('maps Ge\'ez psalter citations onto the Hebrew numbering', () => {
    const psalm = (key: string, service: string) => {
      const reading = catalog.days[key].gitsawe.services[service].psalms[0];
      return reading.canonicalReference;
    };
    // Meskerem 1, the New Year misbak: printed 64, "thou crownest the year".
    expect(psalm('1-1', 'matins')).toMatchObject({ book: 'PSA', chapter: 65, verseStart: 11 });
    // Ge'ez 9 covers Hebrew 9 and 10; verse 25 falls in the second half.
    expect(psalm('2-19', 'vespers')).toMatchObject({ book: 'PSA', chapter: 10, verseStart: 4 });
    // Ge'ez 113 splits into Hebrew 114 and 115.
    expect(psalm('2-26', 'liturgy')).toMatchObject({ book: 'PSA', chapter: 115, verseStart: 14 });
  });
});
