import bibleCatalog from "../py/eotc/bible_catalog.js";

const GEEZ_DIGITS = new Map([
  ["፩", 1], ["፪", 2], ["፫", 3], ["፬", 4], ["፭", 5],
  ["፮", 6], ["፯", 7], ["፰", 8], ["፱", 9], ["፲", 10],
  ["፳", 20], ["፴", 30], ["፵", 40], ["፶", 50], ["፷", 60],
  ["፸", 70], ["፹", 80], ["፺", 90], ["፻", 100], ["፼", 10000],
]);

export function geezToInteger(raw) {
  let total = 0;
  let group = 0;
  let run = 0;
  let found = false;

  for (const char of raw || "") {
    const value = GEEZ_DIGITS.get(char);
    if (!value) continue;
    found = true;
    if (value === 100) {
      group += (run || 1) * 100;
      run = 0;
    } else if (value === 10000) {
      total += (group + run || 1) * 10000;
      group = 0;
      run = 0;
    } else {
      run += value;
    }
  }
  return found ? total + group + run : null;
}

export function normalizeLabel(raw) {
  return (raw || "").normalize("NFC")
    .replace(/[፡።፣፤፥፦፧:,.()\[\]{}'"“”‘’·‧\-–—]/g, " ")
    .replace(/\s+/g, " ").trim();
}

function numbered(label) {
  if (/፫/.test(label)) return 3;
  if (/፪/.test(label)) return 2;
  return 1;
}

export function canonicalBookId(raw) {
  const label = normalizeLabel(raw).replace(/^(ዓዲ|አው|ዘቅዳሴ)\s+/, "");
  if (/መዝ/.test(label)) return "PSA";
  if (/ማቴ/.test(label)) return "MAT";
  if (/ማር/.test(label)) return "MRK";
  if (/ሉቃ/.test(label)) return "LUK";
  if (/ግብ/.test(label) || /^ግ.*ሐዋ/.test(label)) return "ACT";
  if (/ሮሜ/.test(label)) return "ROM";
  if (/ቆሮ|ቆር/.test(label)) return numbered(label) === 2 ? "2CO" : "1CO";
  if (/ገላ|ጌላ/.test(label)) return "GAL";
  if (/ኤፌ|ፌሶን/.test(label)) return "EPH";
  if (/ፊልጵ|ፈልጽ/.test(label)) return "PHP";
  if (/ፊልሞ/.test(label)) return "PHM";
  if (/ቆላ|ቈላ|ቄላ|ቴላ/.test(label)) return "COL";
  if (/ተሰ|ተስ/.test(label)) return numbered(label) === 2 ? "2TH" : "1TH";
  if (/ጢሞ/.test(label)) return numbered(label) === 2 ? "2TI" : "1TI";
  if (/ቲቶ/.test(label)) return "TIT";
  if (/ዕብ/.test(label)) return "HEB";
  if (/ያዕ/.test(label)) return "JAS";
  if (/ጴጥ/.test(label)) return numbered(label) === 2 ? "2PE" : "1PE";
  if (/ዮሐ/.test(label)) {
    if (/ራእ|ራዕ/.test(label)) return "REV";
    if (/ወንጌል/.test(label)) return "JHN";
    const n = numbered(label);
    return n === 3 ? "3JN" : n === 2 ? "2JN" : "1JN";
  }
  if (/ይሁዳ/.test(label)) return "JUD";
  if (/ራእ|ራዕ/.test(label)) return "REV";
  return null;
}

export function normalizeReadingField(raw) {
  const field = (raw || "").normalize("NFC");
  if (field === "epistles_and_acts") return { type: "epistles_and_acts", alternate: false };
  if (field === "ቅዳሴ") return { type: "anaphora", alternate: false };
  const alternate = field.includes("ዓዲ") || field.startsWith("ዓዲ_");
  if (field.includes("ምስባክ") || field.includes("ምስ")) return { type: "mezmur", alternate };
  // Some transcriptions contain Hebrew/Cambodian lookalikes in the last letter.
  if (field.includes("ወንጌ")) return { type: "gospel", alternate };
  return { type: "unknown", alternate, sourceField: raw };
}

const PSALM_VERSE_COUNTS = bibleCatalog.books.find((book) => book.id === "PSA").verseCounts;
const VERSE_COUNTS = new Map(bibleCatalog.books.map((book) => [book.id, book.verseCounts]));

// A citation can parse cleanly and still name a chapter or verse the canon does
// not have, when a Ge'ez numeral was misread or a book label was mis-assigned.
// Such a reference cannot be linked, so it is narrowed to the part that is
// verifiable rather than published as a canonical reference that resolves to
// nothing. The printed citation is preserved separately in every case, and the
// issue is reported so the scan can be reviewed.
export function validateReference(bookId, chapter, verseStart, verseEnd) {
  const counts = VERSE_COUNTS.get(bookId);
  if (!counts || !chapter) return { chapter, verseStart, verseEnd, issue: null };
  if (chapter > counts.length) {
    return { chapter: null, verseStart: null, verseEnd: null,
      issue: { kind: "chapter_out_of_range", chapter, chapterCount: counts.length } };
  }
  const verseCount = counts[chapter - 1];
  if (verseStart && verseStart > verseCount) {
    return { chapter, verseStart: null, verseEnd: null,
      issue: { kind: "verse_out_of_range", chapter, verse: verseStart, verseCount } };
  }
  if (verseEnd && verseEnd > verseCount) {
    return { chapter, verseStart, verseEnd: null,
      issue: { kind: "verse_end_out_of_range", chapter, verse: verseEnd, verseCount } };
  }
  return { chapter, verseStart, verseEnd, issue: null };
}

// The Gitsawe and Sinq sources cite Psalms in the Ge'ez psalter's numbering,
// which follows the Septuagint: one chapter behind the Hebrew numbering used
// by the am-1980/gez-1980 editions for most of the psalter, with merges and
// splits at the edges (LXX 9 = Heb 9+10, LXX 113 = Heb 114+115, LXX 114+115 =
// Heb 116, LXX 146+147 = Heb 147). Canonical references target the
// Hebrew-numbered editions, so printed chapters and verses must be converted
// before they can be linked. Returns null when the citation cannot be
// expressed as one in-range Hebrew reference (Psalm 151, out-of-range verses,
// ranges spanning a Hebrew psalm boundary).
export function geezPsalterToCanonical(chapter, verseStart, verseEnd, toEndOfChapter = false) {
  if (!chapter || chapter < 1) return null;
  const mapVerse = (v) => {
    if (chapter <= 8 || chapter >= 148) return [chapter, v];
    if (chapter === 9) return v !== null && v > 21 ? [10, v - 21] : [9, v];
    if (chapter <= 112) return [chapter + 1, v];
    if (chapter === 113) return v !== null && v > 8 ? [115, v - 8] : [114, v];
    if (chapter === 114) return [116, v];
    if (chapter === 115) return [116, v === null ? null : v + 9];
    if (chapter <= 145) return [chapter + 1, v];
    if (chapter === 146) return [147, v];
    return [147, v === null ? null : v + 11]; // Ge'ez 147 = Hebrew 147:12-20
  };
  const [outChapter, outStart] = mapVerse(verseStart ?? null);
  if (outChapter > PSALM_VERSE_COUNTS.length) return null; // Psalm 151: absent from these editions
  const verseCount = PSALM_VERSE_COUNTS[outChapter - 1];
  if (outStart !== null && outStart > verseCount) return null;
  let outEnd = null;
  let outToEnd = false;
  if (toEndOfChapter) {
    // "To the end" of the Ge'ez chapter: where that chapter's end falls mid
    // Hebrew psalm, pin the explicit final verse; where the range would span
    // into the next Hebrew psalm, it has no single-reference equivalent.
    if (chapter === 114) outEnd = 9; // Ge'ez 114 ends at Hebrew 116:9
    else if (chapter === 146) outEnd = 11; // Ge'ez 146 ends at Hebrew 147:11
    else if (chapter === 9 && outChapter === 9) return null;
    else if (chapter === 113 && outChapter === 114) return null;
    else outToEnd = true;
  } else if (verseEnd !== null && verseEnd !== undefined) {
    const [endChapter, mappedEnd] = mapVerse(verseEnd);
    // A range crossing a Hebrew psalm boundary keeps its start; the end verse
    // cannot be carried into another chapter.
    if (endChapter === outChapter && mappedEnd <= verseCount) outEnd = mappedEnd;
  }
  return { chapter: outChapter, verseStart: outStart, verseEnd: outEnd, toEndOfChapter: outToEnd };
}

export function parseCitation(raw) {
  const source = raw || "";
  const parts = source.split(/[ቍቄ]/, 2);
  const left = parts[0] || "";
  const right = parts[1] || "";
  const chapterMatch = left.replace(/^\s*ም\s*[·.:፡]?/, "").match(/[፩-፼]+/);
  const verseValues = [...right.matchAll(/[፩-፼]+/g)]
    .map((match) => geezToInteger(match[0])).filter(Boolean);
  const toEndOfChapter = /ፍ\s*[፡፣።፥፤,.:·]?\s*ም/.test(source);
  return {
    source,
    chapter: chapterMatch ? geezToInteger(chapterMatch[0]) : null,
    verseStart: verseValues[0] || null,
    verseEnd: toEndOfChapter ? null : (verseValues.at(-1) || null),
    toEndOfChapter,
  };
}
