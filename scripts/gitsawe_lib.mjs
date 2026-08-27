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
