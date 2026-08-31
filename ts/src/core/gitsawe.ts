import catalogJson from '../../../py/eotc/gitsawe_catalog.js';
import { foldEthiopic } from './citations.ts';

export type GitsaweDay = {
  ethiopianMonth: number;
  ethiopianDay: number;
  season: string;
  gitsawe: Record<string, unknown>;
  sinksar: Record<string, unknown>;
};

type GitsaweCatalog = {
  version: number;
  coverage: Record<string, string>;
  days: Record<string, GitsaweDay>;
};

const catalog = catalogJson as GitsaweCatalog;

export function gitsaweCoverage(): Record<string, string> {
  return { ...catalog.coverage };
}

export function fixedGitsaweOn(month: number, day: number): GitsaweDay | null {
  return catalog.days[`${month}-${day}`] ?? null;
}

export interface SinksarMatch {
  title: string;
  kind: 'annual' | 'monthly';
  ethiopianMonth: number;
  ethiopianDay: number;
  confidence: 'exact' | 'partial';
}

type FeastList = { items: { title: string }[] };

/**
 * Find the days on which a commemoration is kept, by any part of its name.
 * Matching is homophone-folded, so a search spelled with any of the Ge'ez
 * letters that share a sound still finds the entry. Annual commemorations
 * appear on one day; monthly ones recur, so a name like ሚካኤል legitimately
 * returns the same day across many months.
 */
export function searchSinksar(query: string): SinksarMatch[] {
  const folded = foldEthiopic(query);
  if (!folded) return [];
  const matches: SinksarMatch[] = [];
  for (const day of Object.values(catalog.days)) {
    const sinksar = day.sinksar as unknown as
      { annualFeasts: FeastList; monthlyFeasts: FeastList } | null;
    if (!sinksar) continue;
    for (const [kind, list] of [['annual', sinksar.annualFeasts], ['monthly', sinksar.monthlyFeasts]] as const) {
      for (const item of list?.items ?? []) {
        const foldedTitle = foldEthiopic(item.title);
        if (!foldedTitle) continue;
        const confidence = foldedTitle === folded ? 'exact'
          : foldedTitle.includes(folded) ? 'partial' : null;
        if (!confidence) continue;
        matches.push({
          title: item.title,
          kind,
          ethiopianMonth: day.ethiopianMonth,
          ethiopianDay: day.ethiopianDay,
          confidence,
        });
      }
    }
  }
  // Exact names first, then in calendar order so a year reads top to bottom.
  matches.sort((a, b) =>
    (a.confidence === b.confidence ? 0 : a.confidence === 'exact' ? -1 : 1)
    || a.ethiopianMonth - b.ethiopianMonth
    || a.ethiopianDay - b.ethiopianDay);
  return matches;
}
