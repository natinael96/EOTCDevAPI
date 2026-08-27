/**
 * Ethiopian <-> Gregorian calendar conversion.
 *
 * The Ethiopian (Ge'ez) calendar has 13 months: twelve of exactly 30 days,
 * plus Pagumen, a short 13th month of 5 days (6 in a leap year).
 * A year is leap when `year % 4 === 3` -- the Year of Luke (ዘመነ ሉቃስ).
 *
 * All conversion goes through the Julian Day Number (JDN), an integer count of
 * days that is calendar-agnostic. Converting A->JDN->B keeps the two calendars
 * from ever needing to know about each other.
 */

/** JDN of Meskerem 1, 1 EC (Amete Mihret epoch) = 29 August 8 CE (Julian). */
const JDN_EPOCH_AMETE_MIHRET = 1723856;

/** Amete Alem (Year of the World) = Amete Mihret + this. Used by Bahire Hasab. */
export const AMETE_FIDA = 5500;

export const MONTHS = [
  { n: 1,  amharic: 'መስከረም', translit: 'Meskerem' },
  { n: 2,  amharic: 'ጥቅምት',  translit: 'Tikimt'   },
  { n: 3,  amharic: 'ኅዳር',   translit: 'Hidar'    },
  { n: 4,  amharic: 'ታኅሣሥ',  translit: 'Tahsas'   },
  { n: 5,  amharic: 'ጥር',    translit: 'Tir'      },
  { n: 6,  amharic: 'የካቲት',  translit: 'Yekatit'  },
  { n: 7,  amharic: 'መጋቢት',  translit: 'Megabit'  },
  { n: 8,  amharic: 'ሚያዝያ',  translit: 'Miyazya'  },
  { n: 9,  amharic: 'ግንቦት',  translit: 'Ginbot'   },
  { n: 10, amharic: 'ሰኔ',    translit: 'Sene'     },
  { n: 11, amharic: 'ሐምሌ',   translit: 'Hamle'    },
  { n: 12, amharic: 'ነሐሴ',   translit: 'Nehase'   },
  { n: 13, amharic: 'ጳጉሜን',  translit: 'Pagumen'  },
] as const;

/** Index 0 = Sunday, matching JS `Date.getDay()` and `jdnToWeekday`. */
export const WEEKDAYS = [
  { n: 0, amharic: 'እሑድ',   translit: 'Ehud',     english: 'Sunday'    },
  { n: 1, amharic: 'ሰኞ',    translit: 'Segno',    english: 'Monday'    },
  { n: 2, amharic: 'ማክሰኞ',  translit: 'Maksegno', english: 'Tuesday'   },
  { n: 3, amharic: 'ረቡዕ',   translit: 'Rebue',    english: 'Wednesday' },
  { n: 4, amharic: 'ሐሙስ',   translit: 'Hamus',    english: 'Thursday'  },
  { n: 5, amharic: 'ዓርብ',   translit: 'Arb',      english: 'Friday'    },
  { n: 6, amharic: 'ቅዳሜ',   translit: 'Kidame',   english: 'Saturday'  },
] as const;

export interface EthiopicDate { year: number; month: number; day: number }
export interface GregorianDate { year: number; month: number; day: number }

/** Ethiopian leap years add a 6th day to Pagumen. Year of Luke: `year % 4 === 3`. */
export function isEthiopicLeapYear(year: number): boolean {
  return ((year % 4) + 4) % 4 === 3;
}

export function isGregorianLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Days in an Ethiopian month: 30 for months 1-12, 5 or 6 for Pagumen. */
export function daysInEthiopicMonth(year: number, month: number): number {
  if (month < 1 || month > 13) throw new RangeError(`month must be 1-13, got ${month}`);
  if (month === 13) return isEthiopicLeapYear(year) ? 6 : 5;
  return 30;
}

export function isValidEthiopicDate(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 1 || m < 1 || m > 13 || d < 1) return false;
  return d <= daysInEthiopicMonth(y, m);
}

export function ethiopicToJDN(year: number, month: number, day: number): number {
  if (!isValidEthiopicDate(year, month, day)) {
    throw new RangeError(`invalid Ethiopian date ${year}-${month}-${day}`);
  }
  return (
    JDN_EPOCH_AMETE_MIHRET + 365 +
    365 * (year - 1) + Math.floor(year / 4) +
    30 * month + day - 31
  );
}

export function jdnToEthiopic(jdn: number): EthiopicDate {
  const r = ((jdn - JDN_EPOCH_AMETE_MIHRET) % 1461 + 1461) % 1461;
  const n = (r % 365) + 365 * Math.floor(r / 1460);
  const year =
    4 * Math.floor((jdn - JDN_EPOCH_AMETE_MIHRET) / 1461) +
    Math.floor(r / 365) - Math.floor(r / 1460);
  const month = Math.floor(n / 30) + 1;
  const day = (n % 30) + 1;
  return { year, month, day };
}

export function gregorianToJDN(year: number, month: number, day: number): number {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return (
    day + Math.floor((153 * m + 2) / 5) + 365 * y +
    Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045
  );
}

export function jdnToGregorian(jdn: number): GregorianDate {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return {
    year: 100 * b + d - 4800 + Math.floor(m / 10),
    month: m + 3 - 12 * Math.floor(m / 10),
    day: e - Math.floor((153 * m + 2) / 5) + 1,
  };
}

export function ethiopicToGregorian(y: number, m: number, d: number): GregorianDate {
  return jdnToGregorian(ethiopicToJDN(y, m, d));
}

export function gregorianToEthiopic(y: number, m: number, d: number): EthiopicDate {
  return jdnToEthiopic(gregorianToJDN(y, m, d));
}

/** 0 = Sunday .. 6 = Saturday. JDN 0 was a Monday, hence the +1. */
export function jdnToWeekday(jdn: number): number {
  return ((jdn + 1) % 7 + 7) % 7;
}
