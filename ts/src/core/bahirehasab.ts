/**
 * ባሕረ ሐሳብ (Bahire Hasab) -- "the sea of thought", the traditional EOTC
 * computation that fixes every movable feast for an Ethiopian year.
 *
 * The chain is:
 *   Amete Alem -> Medeb -> Wenber -> Abekte & Metqi -> Mebaja Hamer
 *   -> (weekday + Tewsak) -> ጾመ ነነዌ (Nineveh) -> every other movable feast
 *
 * Nineveh is the linchpin: all nine remaining movable feasts are a fixed
 * number of days after it (the Tewsak offsets in MOVABLE_FEASTS below).
 *
 * This module computes Fasika independently twice -- once by this traditional
 * route and once by the Alexandrian computus -- and the test suite asserts the
 * two agree for every year in 1900-2100 EC. They are different enough in method
 * that agreeing by accident is not plausible.
 */

import {
  AMETE_FIDA, ethiopicToJDN, jdnToEthiopic, jdnToWeekday,
  type EthiopicDate,
} from './ethiopic.ts';

/** The four-year evangelist cycle. Index = Amete Alem % 4. */
export const EVANGELISTS = [
  { amharic: 'ዮሐንስ',  translit: 'Yohannes', english: 'John'    },
  { amharic: 'ማቴዎስ',  translit: 'Matewos',  english: 'Matthew' },
  { amharic: 'ማርቆስ',  translit: 'Marqos',   english: 'Mark'    },
  { amharic: 'ሉቃስ',   translit: 'Luqas',    english: 'Luke'    },
] as const;

/**
 * ተውሳክ -- days added to the Mebaja Hamer *day-number*, indexed by Mebaja
 * Hamer's weekday (0 = Sunday). Note this is day-of-month arithmetic, not a
 * JDN offset: the count starts from the same day-number four months later
 * (Meskerem -> Tir, Tikimt -> Yekatit).
 *
 * Ethiopian months are all exactly 30 days and 30 % 7 === 2, so four months on
 * is 120 days and 120 % 7 === 1 -- the weekday advances by exactly one. That
 * makes every entry land on a Monday, with the offset always in 2..8.
 */
export const TEWSAK_NINEVEH = [7, 6, 5, 4, 3, 2, 8] as const;

/** Each movable feast as a day offset from Nineveh. */
export const MOVABLE_FEASTS = [
  { key: 'nineveh',       offset: 0,   amharic: 'ጾመ ነነዌ',        translit: 'Tsome Nenewe',   english: 'Fast of Nineveh' },
  { key: 'abiy_tsome',    offset: 14,  amharic: 'ዓቢይ ጾም',        translit: 'Abiy Tsome',     english: 'Great Lent begins' },
  { key: 'debre_zeit',    offset: 41,  amharic: 'ደብረ ዘይት',       translit: 'Debre Zeit',     english: 'Mount of Olives (mid-Lent)' },
  { key: 'hosanna',       offset: 62,  amharic: 'ሆሳዕና',          translit: 'Hosanna',        english: 'Palm Sunday' },
  { key: 'siklet',        offset: 67,  amharic: 'ስቅለት',          translit: 'Siklet',         english: 'Good Friday' },
  { key: 'fasika',        offset: 69,  amharic: 'ትንሣኤ',          translit: 'Tinsae/Fasika',  english: 'Easter (Resurrection)' },
  { key: 'rikbe_kahnat',  offset: 93,  amharic: 'ርክበ ካህናት',      translit: 'Rikbe Kahnat',   english: 'Assembly of the Priests' },
  { key: 'erget',         offset: 108, amharic: 'ዕርገት',          translit: 'Erget',          english: 'Ascension' },
  { key: 'peraklitos',    offset: 118, amharic: 'በዓለ ጰራቅሊጦስ',    translit: "Be'ale Peraklitos", english: 'Pentecost' },
  { key: 'tsome_hawaryat',offset: 119, amharic: 'ጾመ ሐዋርያት',      translit: 'Tsome Hawaryat', english: "Apostles' Fast begins" },
  { key: 'tsome_dihnet',  offset: 121, amharic: 'ጾመ ድህነት',       translit: 'Tsome Dihnet',   english: 'Fast of Salvation begins' },
] as const;

export type MovableFeastKey = (typeof MOVABLE_FEASTS)[number]['key'];

export interface BahireHasab {
  ameteMihret: number;
  ameteAlem: number;
  evangelist: (typeof EVANGELISTS)[number] & { yearOfCycle: number };
  medeb: number;
  wenber: number;
  abekte: number;
  metqi: number;
  mebajaHamer: EthiopicDate & { weekday: number };
  /** New Year's weekday, traditionally መንፈቀ ዕለት / the year's "day pillar". */
  meskeremOneWeekday: number;
  ninevehJDN: number;
}

/**
 * Run the Bahire Hasab chain for an Ethiopian year.
 * `year` is Amete Mihret (the ordinary Ethiopian year, e.g. 2018).
 */
export function bahireHasab(year: number): BahireHasab {
  if (!Number.isInteger(year) || year < 1) {
    throw new RangeError(`Ethiopian year must be a positive integer, got ${year}`);
  }

  const ameteAlem = AMETE_FIDA + year;
  const medeb = ameteAlem % 19;
  const wenber = medeb === 0 ? 18 : medeb - 1;
  const abekte = (wenber * 11) % 30;
  const metqi = (wenber * 19) % 30;

  // Metqi 0 is read as the 30th -- there is no "day zero" -- and that reading
  // happens *before* the month test, so a zero Metqi lands in Meskerem, not
  // Tikimt. (Verified: Meskerem 30 is the only position that reproduces
  // Alexandrian Fasika for all 21 wenber=0 years between 1800-2200 EC.)
  const effectiveMetqi = metqi === 0 ? 30 : metqi;
  const mhMonth = effectiveMetqi > 14 ? 1 : 2;   // 1 = Meskerem, 2 = Tikimt
  const mhDay = effectiveMetqi;

  const mhJDN = ethiopicToJDN(year, mhMonth, mhDay);
  const mhWeekday = jdnToWeekday(mhJDN);

  // Nineveh is counted from the same day-number four months after Mebaja
  // Hamer: Meskerem -> Tir, Tikimt -> Yekatit. Adding the Tewsak there always
  // lands on the Monday that opens the fast.
  const ninevehJDN = ethiopicToJDN(year, mhMonth + 4, mhDay) + TEWSAK_NINEVEH[mhWeekday];

  return {
    ameteMihret: year,
    ameteAlem,
    evangelist: { ...EVANGELISTS[ameteAlem % 4], yearOfCycle: ameteAlem % 4 },
    medeb,
    wenber,
    abekte,
    metqi,
    mebajaHamer: { year, month: mhMonth, day: mhDay, weekday: mhWeekday },
    meskeremOneWeekday: jdnToWeekday(ethiopicToJDN(year, 1, 1)),
    ninevehJDN,
  };
}

/** JDN of one movable feast in the given Ethiopian year. */
export function movableFeastJDN(year: number, key: MovableFeastKey): number {
  const feast = MOVABLE_FEASTS.find((f) => f.key === key);
  if (!feast) throw new RangeError(`unknown movable feast '${key}'`);
  return bahireHasab(year).ninevehJDN + feast.offset;
}

/** Every movable feast for the year, in chronological order. */
export function movableFeasts(year: number) {
  const { ninevehJDN } = bahireHasab(year);
  return MOVABLE_FEASTS.map((f) => {
    const jdn = ninevehJDN + f.offset;
    return { ...f, jdn, ethiopic: jdnToEthiopic(jdn), weekday: jdnToWeekday(jdn) };
  });
}

// --- Independent cross-check: the Alexandrian computus -------------------

/** JDN from a *Julian*-calendar date (the computus works in Julian reckoning). */
export function julianToJDN(year: number, month: number, day: number): number {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - 32083;
}

/**
 * Alexandrian (Julian) computus -- the Meeus algorithm. Returns the JDN of
 * Orthodox Easter for a Gregorian year. Used only to verify Bahire Hasab.
 */
export function alexandrianEasterJDN(gregorianYear: number): number {
  const a = gregorianYear % 4;
  const b = gregorianYear % 7;
  const c = gregorianYear % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  return julianToJDN(gregorianYear, month, day);
}
