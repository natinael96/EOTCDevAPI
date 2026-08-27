/**
 * The canonical "day" payload -- the single object every endpoint that
 * describes a date returns. Mirrored exactly by py/eotc/day.py so both services
 * are byte-compatible.
 */
import {
  MONTHS, WEEKDAYS, jdnToEthiopic, jdnToGregorian, jdnToWeekday,
  ethiopicToJDN, isEthiopicLeapYear, daysInEthiopicMonth,
} from './ethiopic.ts';
import { fastingStatus } from './fasts.ts';
import { commemorationsOn, fixedFeastsOn } from './feasts.ts';
import { movableFeasts } from './bahirehasab.ts';

export const iso = (jdn: number): string => {
  const g = jdnToGregorian(jdn);
  return `${String(g.year).padStart(4, '0')}-${String(g.month).padStart(2, '0')}-${String(g.day).padStart(2, '0')}`;
};

export const ethIso = (y: number, m: number, d: number): string =>
  `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Everything the API knows about a single day. */
export function describeDay(jdn: number) {
  const g = jdnToGregorian(jdn);
  const e = jdnToEthiopic(jdn);
  const wd = jdnToWeekday(jdn);
  const month = MONTHS[e.month - 1];
  const status = fastingStatus(jdn, e.year);

  // A movable feast landing on this exact day, if any.
  const movable = [e.year - 1, e.year, e.year + 1]
    .filter((y) => y >= 1)
    .flatMap((y) => movableFeasts(y))
    .filter((f) => f.jdn === jdn)
    .map((f) => ({ key: f.key, amharic: f.amharic, translit: f.translit, english: f.english, movable: true }));

  const fixed = fixedFeastsOn(e).map((f) => ({
    key: f.key, amharic: f.amharic, translit: f.translit, english: f.english,
    major: f.major, movable: false,
  }));

  return {
    jdn,
    gregorian: { date: iso(jdn), year: g.year, month: g.month, day: g.day },
    ethiopic: {
      date: ethIso(e.year, e.month, e.day),
      year: e.year, month: e.month, day: e.day,
      monthName: { amharic: month.amharic, translit: month.translit },
      isLeapYear: isEthiopicLeapYear(e.year),
      daysInMonth: daysInEthiopicMonth(e.year, e.month),
    },
    weekday: { ...WEEKDAYS[wd] },
    fasting: {
      isFasting: status.isFasting,
      weeklyFast: status.weeklyFast,
      fastFreeSeason: status.fastFreeSeason,
      feastOverride: status.feastOverride,
      reason: status.reason,
      periods: status.periods.map((p) => ({
        key: p.key, amharic: p.amharic, translit: p.translit, english: p.english,
        start: iso(p.startJDN), end: iso(p.endJDN), days: p.days, movable: p.movable,
        dayOfPeriod: jdn - p.startJDN + 1,
      })),
    },
    feasts: [...movable, ...fixed],
    commemorations: commemorationsOn(e).map((c) => ({
      amharic: c.amharic, translit: c.translit, english: c.english,
    })),
  };
}
