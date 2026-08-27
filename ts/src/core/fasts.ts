/**
 * አጽዋማት -- the seven canonical fasts of the Ethiopian Orthodox Tewahedo Church,
 * and the rule for deciding whether any given day is a fasting day.
 *
 * Two kinds of fast live here:
 *   - Fixed:   anchored to Ethiopian calendar dates (Filseta, Nebiyat, Gahad)
 *   - Movable: anchored to Nineveh via Bahire Hasab (Nineveh, Lent, Apostles')
 *
 * Plus the weekly ጾመ ድህነት: every Wednesday and Friday, suspended during the
 * fifty days from Fasika to Pentecost (ሃምሳ) when no weekly fast is kept.
 */

import { ethiopicToJDN, jdnToWeekday, daysInEthiopicMonth } from './ethiopic.ts';
import { bahireHasab, movableFeastJDN } from './bahirehasab.ts';

export interface FastPeriod {
  key: string;
  amharic: string;
  translit: string;
  english: string;
  /** Inclusive JDN bounds. */
  startJDN: number;
  endJDN: number;
  days: number;
  movable: boolean;
  description: string;
}

/**
 * Every dated fasting period of an Ethiopian year, chronologically.
 * The weekly Wed/Fri fast is not a period and is handled by `fastingStatus`.
 */
export function fastPeriods(year: number): FastPeriod[] {
  const nineveh = bahireHasab(year).ninevehJDN;
  const fasika = movableFeastJDN(year, 'fasika');
  const pentecost = movableFeastJDN(year, 'peraklitos');
  const ec = (m: number, d: number) => ethiopicToJDN(year, m, d);

  const mk = (
    key: string, amharic: string, translit: string, english: string,
    startJDN: number, endJDN: number, movable: boolean, description: string,
  ): FastPeriod => ({
    key, amharic, translit, english, startJDN, endJDN,
    days: endJDN - startJDN + 1, movable, description,
  });

  return [
    mk('tsome_nebiyat', 'ጾመ ነቢያት', 'Tsome Nebiyat', "Prophets' Fast (Advent)",
       ec(3, 15), ec(4, 28), false,
       'From Hidar 15 to the eve of Gena, kept in expectation of the Nativity.'),

    mk('gahad_gena', 'ጾመ ገሃድ (ገና)', 'Tsome Gahad (Gena)', 'Christmas Eve Fast',
       ec(4, 28), ec(4, 28), false,
       'The strict single-day fast on the eve of the Nativity.'),

    mk('gahad_timket', 'ጾመ ገሃድ (ጥምቀት)', 'Tsome Gahad (Timket)', 'Epiphany Eve Fast',
       ec(5, 10), ec(5, 10), false,
       'The strict single-day fast on the eve of Timket.'),

    mk('tsome_nenewe', 'ጾመ ነነዌ', 'Tsome Nenewe', 'Fast of Nineveh',
       nineveh, nineveh + 2, true,
       "Three days recalling Jonah's preaching to Nineveh. Always Monday to Wednesday."),

    mk('abiy_tsome', 'ዓቢይ ጾም', 'Abiy Tsome (Hudade)', 'Great Lent',
       nineveh + 14, fasika - 1, true,
       'Fifty-five days: the eight-day ጾመ ሕርቃል, the Forty Days, and Holy Week (ሰሙነ ሕማማት).'),

    mk('tsome_hawaryat', 'ጾመ ሐዋርያት', 'Tsome Hawaryat', "Apostles' Fast",
       pentecost + 1, ec(11, 5), true,
       'From the Monday after Pentecost until Hamle 5, the feast of Peter and Paul.'),

    mk('tsome_filseta', 'ጾመ ፍልሰታ', 'Tsome Filseta', 'Fast of the Assumption',
       ec(12, 1), ec(12, 16), false,
       'Sixteen days for the Assumption of the Virgin Mary. Widely kept by the laity.'),
  ].sort((a, b) => a.startJDN - b.startJDN);
}

/**
 * Great feasts of the Lord that lift the weekly Wednesday/Friday fast when they
 * fall on one, as [month, day] in the Ethiopian calendar. Gena and Timket are
 * the two that fall outside the paschal season; the fifty days after Fasika are
 * handled separately by `fastFreeSeason`.
 */
const WEEKLY_FAST_EXEMPT: ReadonlyArray<readonly [number, number]> = [
  [4, 29], // ገና      Gena   -- the Nativity
  [5, 11], // ጥምቀት    Timket -- Theophany
];

export interface FastingStatus {
  isFasting: boolean;
  /** Named periods covering this day; usually 0 or 1, occasionally 2 at a seam. */
  periods: FastPeriod[];
  /** True when the day fasts only because it is a Wednesday or Friday. */
  weeklyFast: boolean;
  /** True inside the fifty days when the weekly fast is lifted. */
  fastFreeSeason: boolean;
  /** True when a great feast of the Lord lifts the weekly fast. */
  feastOverride: boolean;
  reason: string;
}

/**
 * Decide whether a JDN is a fasting day.
 *
 * The year boundary matters: a JDN near the edges of an Ethiopian year can fall
 * inside a period belonging to the neighbouring year (the Apostles' Fast can run
 * long, and Advent starts in Hidar), so neighbours are checked too.
 */
export function fastingStatus(jdn: number, ethiopicYear: number): FastingStatus {
  const periods = [ethiopicYear - 1, ethiopicYear, ethiopicYear + 1]
    .flatMap((y) => (y >= 1 ? fastPeriods(y) : []))
    .filter((p) => jdn >= p.startJDN && jdn <= p.endJDN);

  // ሃምሳ -- the fifty days from Fasika to Pentecost inclusive, when the weekly
  // Wednesday/Friday fast is suspended. Check both adjacent years: the season
  // never crosses a year boundary, but which year owns it depends on the date.
  const fastFreeSeason = [ethiopicYear - 1, ethiopicYear, ethiopicYear + 1].some((y) => {
    if (y < 1) return false;
    return jdn >= movableFeastJDN(y, 'fasika') && jdn <= movableFeastJDN(y, 'peraklitos');
  });

  // A great feast of the Lord outranks the weekly fast. Check the neighbouring
  // years too, since a JDN near a year edge belongs to one of them.
  const feastOverride = [ethiopicYear - 1, ethiopicYear, ethiopicYear + 1].some(
    (y) => y >= 1 && WEEKLY_FAST_EXEMPT.some(([m, d]) => ethiopicToJDN(y, m, d) === jdn),
  );

  const weekday = jdnToWeekday(jdn);
  const isWedOrFri = weekday === 3 || weekday === 5;
  const weeklyFast = isWedOrFri && !fastFreeSeason && !feastOverride;
  const isFasting = periods.length > 0 || weeklyFast;

  let reason: string;
  if (feastOverride && periods.length === 0) {
    reason = 'Not a fasting day: a great feast of the Lord lifts the weekly fast.';
  } else if (periods.length > 0) {
    reason = periods.map((p) => `${p.amharic} (${p.english})`).join('; ');
  } else if (weeklyFast) {
    reason = `ጾመ ድህነት -- the weekly ${weekday === 3 ? 'Wednesday' : 'Friday'} fast`;
  } else if (isWedOrFri && fastFreeSeason) {
    reason = 'Not a fasting day: the weekly fast is lifted during the fifty days after Fasika.';
  } else {
    reason = 'Not a fasting day.';
  }

  return { isFasting, periods, weeklyFast, fastFreeSeason, feastOverride, reason };
}

/** Count of fasting days in an Ethiopian year -- useful as a sanity check. */
export function fastingDayCount(year: number): number {
  let n = 0;
  for (let m = 1; m <= 13; m++)
    for (let d = 1; d <= daysInEthiopicMonth(year, m); d++)
      if (fastingStatus(ethiopicToJDN(year, m, d), year).isFasting) n++;
  return n;
}
