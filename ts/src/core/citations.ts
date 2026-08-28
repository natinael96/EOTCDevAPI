/**
 * Ge'ez numeral and citation parsing, plus Ethiopic text folding for search.
 *
 * The folding maps every homophone fidel series to one canonical series so
 * that spellings which sound identical compare equal: ሐ/ኀ fold into ሀ,
 * ሠ into ሰ, ዐ into አ, ፀ into ጸ, and the interchangeable first/fourth
 * orders of the guttural series fold together (ሀ/ሃ, አ/ኣ). Arabic digits
 * fold into Ge'ez numerals so "2 ጴጥሮስ" matches "፪ኛ ጴጥሮስ".
 *
 * The citation grammar accepts the printed Gitsawe style (ም· ፲ ቍ· ፩ – ፳፪),
 * plain chapter:verse ranges (3:16-18), and space-separated numerals.
 * The Python twin is py/eotc/citations.py; shared fixtures hold them equal.
 */

const GEEZ_DIGITS = new Map([
  ['፩', 1], ['፪', 2], ['፫', 3], ['፬', 4], ['፭', 5],
  ['፮', 6], ['፯', 7], ['፰', 8], ['፱', 9], ['፲', 10],
  ['፳', 20], ['፴', 30], ['፵', 40], ['፶', 50], ['፷', 60],
  ['፸', 70], ['፹', 80], ['፺', 90], ['፻', 100], ['፼', 10000],
]);

export function geezToInteger(raw: string): number | null {
  let total = 0, group = 0, run = 0;
  let found = false;
  for (const char of raw || '') {
    const value = GEEZ_DIGITS.get(char);
    if (!value) continue;
    found = true;
    if (value === 100) { group += (run || 1) * 100; run = 0; }
    else if (value === 10000) { total += (group + run || 1) * 10000; group = 0; run = 0; }
    else run += value;
  }
  return found ? total + group + run : null;
}

// Homophone series: each string pairs source characters with the canonical
// character at the same vowel order. Kept flat so the Python twin can share
// the exact table.
const FOLD_PAIRS: [string, string][] = [
  ['ሐሑሒሓሔሕሖ', 'ሀሁሂሃሄህሆ'],
  ['ኀኁኂኃኄኅኆ', 'ሀሁሂሃሄህሆ'],
  ['ኻኺኼኽ', 'ሃሂሄህ'],
  ['ሠሡሢሣሤሥሦ', 'ሰሱሲሳሴስሶ'],
  ['ዐዑዒዓዔዕዖ', 'አኡኢኣኤእኦ'],
  ['ፀፁፂፃፄፅፆ', 'ጸጹጺጻጼጽጾ'],
  ['1234567890', '፩፪፫፬፭፮፯፰፱0'],
];
const FOLD_MAP = new Map<string, string>();
for (const [from, to] of FOLD_PAIRS) {
  for (let i = 0; i < from.length; i++) FOLD_MAP.set(from[i], to[i]);
}
// The first and fourth orders of the guttural series are used interchangeably.
FOLD_MAP.set('ሃ', 'ሀ');
FOLD_MAP.set('ኣ', 'አ');

/**
 * Fold Ethiopic text for comparison: homophone series unified, punctuation
 * and whitespace removed, Latin lowercased, Arabic digits as Ge'ez numerals.
 */
export function foldEthiopic(raw: string): string {
  let out = '';
  for (const char of (raw || '').normalize('NFC').toLowerCase()) {
    if (/[\s፡።፣፤፥፦፧·‧.,:;!?"'“”‘’()\[\]{}\-–—/\\]/.test(char)) continue;
    out += FOLD_MAP.get(char) ?? char;
  }
  return out;
}

export interface ParsedCitation {
  chapter: number | null;
  verseStart: number | null;
  verseEnd: number | null;
  toEndOfChapter: boolean;
}

/**
 * Parse the numeric part of a citation. Handles the printed Gitsawe grammar
 * (chapter after ም, verses after ቍ, ፍጻሜ ምዕራፍ as "to end of chapter"),
 * plain `3:16-18`, and bare space-separated numbers (`3 16 18`).
 */
export function parseCitation(raw: string): ParsedCitation {
  const source = (raw || '').trim();
  const none: ParsedCitation = { chapter: null, verseStart: null, verseEnd: null, toEndOfChapter: false };
  if (!source) return none;

  const latin = /^(\d+)(?:\s*[:.]\s*(\d+)(?:\s*[-–]\s*(\d+))?)?$/.exec(source);
  if (latin) {
    return {
      chapter: Number(latin[1]),
      verseStart: latin[2] ? Number(latin[2]) : null,
      verseEnd: latin[3] ? Number(latin[3]) : null,
      toEndOfChapter: false,
    };
  }

  if (/[ቍቊ]/.test(source) || /ም/.test(source) || /[፩-፼]/.test(source)) {
    const parts = source.split(/[ቍቊ]/);
    const left = parts[0] ?? '';
    const right = parts.slice(1).join(' ');
    const toEndOfChapter = /ፍ\s*[፡፣።፥፤,.:·]?\s*ም/.test(source);
    const chapterMatch = left.replace(/^\s*ም(?:ዕራፍ)?\s*[·.:፡]?/, '').match(/[፩-፼]+|\d+/);
    const readNumber = (token: string) => /^\d+$/.test(token) ? Number(token) : geezToInteger(token);
    let verseValues: number[] = [];
    if (parts.length > 1) {
      verseValues = [...right.matchAll(/[፩-፼]+|\d+/g)]
        .map((match) => readNumber(match[0])).filter((n): n is number => n !== null && n > 0);
    } else {
      // No ቍ marker: first number is the chapter, the rest are verses.
      const all = [...left.matchAll(/[፩-፼]+|\d+/g)]
        .map((match) => readNumber(match[0])).filter((n): n is number => n !== null && n > 0);
      verseValues = all.slice(1);
      if (all.length) return {
        chapter: all[0],
        verseStart: verseValues[0] ?? null,
        verseEnd: toEndOfChapter ? null : (verseValues.length > 1 ? verseValues[verseValues.length - 1] : null),
        toEndOfChapter,
      };
      return { ...none, toEndOfChapter };
    }
    return {
      chapter: chapterMatch ? readNumber(chapterMatch[0]) : null,
      verseStart: verseValues[0] ?? null,
      verseEnd: toEndOfChapter ? null : (verseValues.length > 1 ? verseValues[verseValues.length - 1] : null),
      toEndOfChapter,
    };
  }

  return none;
}
