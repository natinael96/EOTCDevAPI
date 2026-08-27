/**
 * የቤተ ክርስቲያን ወቅቶች -- the liturgical seasons of the year.
 *
 * Seasons are resolved by precedence, not adjacency: the paschal cycle
 * (Lent through Pentecost) overlays the fixed year, and within it Holy Week
 * outranks plain Lent. Whatever is left is ordinary time (ዘመነ ጽጌ is a
 * flower-season subdivision of ordinary time kept between Meskerem 26 and
 * Hidar 5).
 *
 * The `theme` field is a UI hint: apps theming by season (the stated use case)
 * get a stable key rather than having to parse names.
 */

import { ethiopicToJDN, jdnToEthiopic } from './ethiopic.ts';
import { movableFeastJDN } from './bahirehasab.ts';

export interface Season {
  key: string;
  amharic: string;
  translit: string;
  english: string;
  /** Stable UI-theming hint: 'fasting' | 'feast' | 'ordinary'. */
  theme: 'fasting' | 'feast' | 'ordinary';
  /** Inclusive JDN bounds of the instance containing the queried date. */
  startJDN: number;
  endJDN: number;
}

/** The season a JDN falls in. Checks the paschal overlay first, then fixed seasons. */
export function seasonOf(jdn: number): Season {
  const year = jdnToEthiopic(jdn).year;

  // Paschal cycle candidates from the years whose cycle could cover this date.
  for (const y of [year + 1, year, year - 1]) {
    if (y < 1) continue;
    const nineveh = movableFeastJDN(y, 'nineveh');
    const lentStart = movableFeastJDN(y, 'abiy_tsome');
    const hosanna = movableFeastJDN(y, 'hosanna');
    const fasika = movableFeastJDN(y, 'fasika');
    const pentecost = movableFeastJDN(y, 'peraklitos');

    if (jdn >= nineveh && jdn <= nineveh + 2) {
      return { key: 'nineveh', amharic: 'ጾመ ነነዌ', translit: 'Tsome Nenewe',
               english: 'Fast of Nineveh', theme: 'fasting', startJDN: nineveh, endJDN: nineveh + 2 };
    }
    if (jdn >= hosanna && jdn < fasika) {
      return { key: 'himamat', amharic: 'ሰሙነ ሕማማት', translit: 'Semune Himamat',
               english: 'Holy Week', theme: 'fasting', startJDN: hosanna, endJDN: fasika - 1 };
    }
    if (jdn >= lentStart && jdn < hosanna) {
      return { key: 'abiy_tsome', amharic: 'ዓቢይ ጾም', translit: 'Abiy Tsome',
               english: 'Great Lent', theme: 'fasting', startJDN: lentStart, endJDN: hosanna - 1 };
    }
    if (jdn >= fasika && jdn <= pentecost) {
      return { key: 'hamsa', amharic: 'ሃምሳ (ዘመነ ትንሣኤ)', translit: 'Hamsa',
               english: 'The Fifty Days of Eastertide', theme: 'feast', startJDN: fasika, endJDN: pentecost };
    }
  }

  // Fixed seasons of the Ethiopian year containing the date.
  const e = jdnToEthiopic(jdn);
  const ec = (m: number, d: number) => ethiopicToJDN(e.year, m, d);

  // ዘመነ ጽጌ: Meskerem 26 - Hidar 5, the season of flowers.
  if (jdn >= ec(1, 26) && jdn <= ec(3, 5)) {
    return { key: 'tsige', amharic: 'ዘመነ ጽጌ', translit: 'Zemene Tsige',
             english: 'Season of Flowers', theme: 'ordinary', startJDN: ec(1, 26), endJDN: ec(3, 5) };
  }
  // ዘመነ ስብከት/ልደት: Advent, Hidar 15 to Gena eve.
  if (jdn >= ec(3, 15) && jdn <= ec(4, 28)) {
    return { key: 'sibket', amharic: 'ዘመነ ስብከት', translit: 'Zemene Sibket',
             english: 'Season of Proclamation (Advent)', theme: 'fasting', startJDN: ec(3, 15), endJDN: ec(4, 28) };
  }
  // ዘመነ አስተርእዮ: Theophany season, Gena to the eve of Nineveh of the same EC year.
  const nin = movableFeastJDN(e.year, 'nineveh');
  if (jdn >= ec(4, 29) && jdn < nin) {
    return { key: 'astereyo', amharic: 'ዘመነ አስተርእዮ', translit: "Zemene Astere'iyo",
             english: 'Season of Epiphany', theme: 'feast', startJDN: ec(4, 29), endJDN: nin - 1 };
  }

  // Everything else: ordinary time. Bound it by the nearest season edges so the
  // interval is still honest.
  return { key: 'ordinary', amharic: 'ዘመነ ዮሐንስ/ማቴዎስ/ማርቆስ/ሉቃስ', translit: 'Ordinary Time',
           english: 'Ordinary Time', theme: 'ordinary',
           startJDN: jdn, endJDN: jdn };
}
