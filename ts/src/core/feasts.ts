/**
 * በዓላት -- fixed feasts and monthly commemorations.
 *
 * Fixed feasts sit on a set Ethiopian calendar date, so their Gregorian date
 * drifts by a day depending on where the year falls in the leap cycle. Movable
 * feasts live in bahirehasab.ts, anchored to Nineveh.
 *
 * Monthly commemorations (ወርሃዊ በዓላት) recur on the same day of every month --
 * Michael on the 12th, Mary on the 21st, and so on.
 */

import { ethiopicToJDN, jdnToWeekday, daysInEthiopicMonth, type EthiopicDate } from './ethiopic.ts';

export interface FixedFeast {
  key: string; month: number; day: number;
  amharic: string; translit: string; english: string;
  major: boolean;
}

/** Annual feasts on a fixed Ethiopian date. */
export const FIXED_FEASTS: readonly FixedFeast[] = [
  { key:'enkutatash',   month:1,  day:1,  amharic:'እንቁጣጣሽ',        translit:'Enkutatash',      english:'Ethiopian New Year',              major:true  },
  { key:'meskel',       month:1,  day:17, amharic:'መስቀል',          translit:'Meskel',          english:'Finding of the True Cross',       major:true  },
  { key:'gena',         month:4,  day:29, amharic:'ገና',            translit:'Gena',            english:'Nativity (Christmas)',            major:true  },
  { key:'timket',       month:5,  day:11, amharic:'ጥምቀት',          translit:'Timket',          english:'Theophany (Epiphany)',            major:true  },
  { key:'kana_zegelila',month:5,  day:12, amharic:'ቃና ዘገሊላ',       translit:'Kana Zegelila',   english:'Wedding at Cana',                 major:false },
  { key:'kidane_mihret',month:6,  day:16, amharic:'ኪዳነ ምሕረት',      translit:'Kidane Mihret',   english:'Covenant of Mercy',               major:false },
  { key:'giyorgis',     month:8,  day:23, amharic:'ቅዱስ ጊዮርጊስ',     translit:'Qidus Giyorgis',  english:'St George',                       major:false },
  { key:'lideta',       month:9,  day:1,  amharic:'ልደታ ለማርያም',     translit:'Lideta LeMaryam', english:'Nativity of the Virgin Mary',     major:false },
  { key:'petros_pawlos',month:11, day:5,  amharic:'ጴጥሮስ ወጳውሎስ',    translit:'Petros WePawlos', english:'Sts Peter and Paul',              major:true  },
  { key:'gabriel',      month:11, day:19, amharic:'ቅዱስ ገብርኤል',     translit:'Qidus Gabriel',   english:'St Gabriel the Archangel',        major:false },
  { key:'buhe',         month:12, day:13, amharic:'ቡሄ (ደብረ ታቦር)',  translit:'Buhe',            english:'Transfiguration',                 major:true  },
  { key:'filseta',      month:12, day:16, amharic:'ፍልሰታ ለማርያም',    translit:'Filseta',         english:'Assumption of the Virgin Mary',   major:true  },
] as const;

export interface MonthlyCommemoration {
  day: number; amharic: string; translit: string; english: string;
}

/** ወርሃዊ በዓላት -- commemorations recurring on the same day of every month. */
export const MONTHLY_COMMEMORATIONS: readonly MonthlyCommemoration[] = [
  { day:1,  amharic:'ልደታ ለማርያም',      translit:'Lideta LeMaryam',    english:'Nativity of the Virgin Mary' },
  { day:5,  amharic:'አቦ (ገብረ መንፈስ ቅዱስ)',translit:'Abo',              english:'Abune Gebre Menfes Kidus'    },
  { day:7,  amharic:'ሥላሴ',             translit:'Selassie',           english:'The Holy Trinity'            },
  { day:12, amharic:'ቅዱስ ሚካኤል',        translit:'Qidus Mikael',       english:'St Michael the Archangel'    },
  { day:14, amharic:'አቡነ አረጋዊ',        translit:'Abune Aregawi',      english:'Abune Aregawi'               },
  { day:16, amharic:'ኪዳነ ምሕረት',        translit:'Kidane Mihret',      english:'Covenant of Mercy'           },
  { day:19, amharic:'ቅዱስ ገብርኤል',       translit:'Qidus Gabriel',      english:'St Gabriel the Archangel'    },
  { day:21, amharic:'ቅድስት ማርያም',       translit:'Qidist Maryam',      english:'The Virgin Mary'             },
  { day:23, amharic:'ቅዱስ ጊዮርጊስ',       translit:'Qidus Giyorgis',     english:'St George'                   },
  { day:24, amharic:'አቡነ ተክለ ሃይማኖት',   translit:'Abune Tekle Haymanot',english:'Abune Tekle Haymanot'       },
  { day:27, amharic:'መድኃኔዓለም',         translit:'Medhane Alem',       english:'Saviour of the World'        },
  { day:29, amharic:'በዓለ ወልድ',         translit:"Be'ale Wold",        english:'Commemoration of the Son'    },
] as const;

/** All fixed feasts of an Ethiopian year, with their JDN and weekday. */
export function fixedFeasts(year: number) {
  return FIXED_FEASTS.map((f) => {
    const jdn = ethiopicToJDN(year, f.month, f.day);
    return { ...f, jdn, ethiopic: { year, month: f.month, day: f.day }, weekday: jdnToWeekday(jdn) };
  }).sort((a, b) => a.jdn - b.jdn);
}

/** Fixed feasts falling on a specific Ethiopian date. */
export function fixedFeastsOn(d: EthiopicDate) {
  return FIXED_FEASTS.filter((f) => f.month === d.month && f.day === d.day);
}

/** Monthly commemorations for a date. Pagumen is short, so it has few or none. */
export function commemorationsOn(d: EthiopicDate) {
  if (d.day > daysInEthiopicMonth(d.year, d.month)) return [];
  return MONTHLY_COMMEMORATIONS.filter((c) => c.day === d.day);
}
