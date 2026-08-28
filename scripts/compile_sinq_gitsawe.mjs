// Compile the frozen Sinq snapshot (data/sinq-gitsawe/) into the shared
// sinq_catalog.js runtime artifact plus quality and reconciliation reports.
//
// The importer is lossless toward the snapshot (never edits it) and lossy by
// policy toward the runtime: reading bodies and chant verse text stay out of
// the generated artifact until data/sinq-gitsawe/manifest.json records
// publication rights for them. Structure, stable IDs, verse references,
// titles, matching metadata, and the feast graph are carried through.
import fs from "node:fs";
import path from "node:path";
import { canonicalBookId, geezToInteger } from "./gitsawe_lib.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));

const manifest = read("data/sinq-gitsawe/manifest.json");
const upstream = read("data/sinq-gitsawe/upstream-npm.json");
const daily = read("data/sinq-gitsawe/daily-gitsawe.json");
const seasonal = read("data/sinq-gitsawe/seasonal-gitsawe.json");
const monthly = read("data/sinq-gitsawe/monthly-gitsawe.json");
const feasts = read("data/sinq-gitsawe/feasts.json");
const subFeasts = read("data/sinq-gitsawe/sub-feasts.json");
const mahlets = read("data/sinq-gitsawe/mahlets.json");
const months = read("data/sinq-gitsawe/months.json");
const packages = read("data/sinq-gitsawe/packages.json");
const fixedCatalog = JSON.parse(
  fs.readFileSync(path.join(root, "py/eotc/gitsawe_catalog.js"), "utf8")
    .replace(/^export default /, "").replace(/;\s*$/, ""),
);

const errors = [];
const report = {
  version: 1,
  counts: {
    input: {
      daily: daily.length, seasonal: seasonal.length, monthly: monthly.length,
      feasts: feasts.length, subFeasts: subFeasts.length, mahlets: mahlets.length,
      months: months.length, packages: packages.length,
    },
    output: {},
    readings: { normalized: 0, resolvedBooks: 0, unresolvedBooks: 0, slotFamilyMismatches: 0 },
    dailyProvenance: { npmDerived: 0, scanBackfilled: 0 },
  },
  reviewItems: [],
};
const review = (item) => report.reviewItems.push(item);

// ---- Enumerations ----------------------------------------------------------

const SERVICE_MAP = { negh: "matins", kidassie: "liturgy", serk: "vespers" };
const SLOT_MAP = {
  msbak: "psalm", wengel: "gospel",
  firstDeacon: "paulineEpistle", secondDeacon: "catholicEpistle", secondKahn: "acts",
};
const SERVICE_SLOTS = {
  negh: ["msbak", "wengel"],
  serk: ["msbak", "wengel"],
  kidassie: ["msbak", "wengel", "firstDeacon", "secondDeacon", "secondKahn", "kidassie"],
};
const SLOT_FAMILIES = {
  psalm: new Set(["PSA"]),
  gospel: new Set(["MAT", "MRK", "LUK", "JHN"]),
  paulineEpistle: new Set(["ROM", "1CO", "2CO", "GAL", "EPH", "PHP", "COL",
    "1TH", "2TH", "1TI", "2TI", "TIT", "PHM", "HEB"]),
  catholicEpistle: new Set(["JAS", "1PE", "2PE", "1JN", "2JN", "3JN", "JUD"]),
  acts: new Set(["ACT"]),
};
const SEASONS = new Set(["abiyTsom", "astemhro", "erget", "filseta", "genaTsom",
  "holy_thursday", "kremt", "lidet", "neneweTsom", "pagumen", "tnsae", "zere_demena"]);
const MONTH_KEYS = { meskerem: 1, tikimt: 2, hidar: 3, tahsas: 4, tir: 5, yekatit: 6,
  megabit: 7, miyazya: 8, ginbot: 9, sene: 10, hamle: 11, nehase: 12, pagumen: 13 };

// Chapter bounds from the local validation edition (CC BY-NC-ND, used only for
// local validation per the V1 scope — nothing from it enters the artifact).
const canon = read("data/bible/canon.json");
const chapterCounts = new Map();
for (const book of canon) {
  const file = path.join(root, "data/bible/am-1980/books", book.file);
  if (!fs.existsSync(file)) continue;
  chapterCounts.set(book.id, JSON.parse(fs.readFileSync(file, "utf8")).chapters.length);
}

// ---- Helpers ---------------------------------------------------------------

// Sinq labels number books with Arabic digits as often as Ge'ez ones
// ("የጴጥሮስ መልእክት 2"); canonicalBookId only reads the Ge'ez numerals.
function sinqBookId(title) {
  if (!title) return null;
  const t = title.replace(/(^|[\s፡])1(?=$|[\sኛና])/g, "$1፩")
    .replace(/(^|[\s፡])2(?=$|[\sኛና])/g, "$1፪")
    .replace(/(^|[\s፡])3(?=$|[\sኛና])/g, "$1፫");
  return canonicalBookId(t);
}

const intOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
};

function normalizedReading(reading, sourceSlot, where) {
  const slot = SLOT_MAP[sourceSlot];
  const verse = reading.verse || {};
  const bibleBook = sinqBookId(verse.bookTitle);
  report.counts.readings.normalized++;
  if (bibleBook) report.counts.readings.resolvedBooks++;
  else {
    report.counts.readings.unresolvedBooks++;
    review({ kind: "unresolved_bible_book", where, sourceSlot,
      sourceBookTitle: verse.bookTitle ?? null });
  }
  const chapter = intOrNull(verse.chapter);
  if (bibleBook && chapter && chapterCounts.has(bibleBook) && chapter > chapterCounts.get(bibleBook)) {
    review({ kind: "chapter_out_of_range", where, sourceSlot, bibleBook, chapter,
      chapterCount: chapterCounts.get(bibleBook), versification: "am-1980" });
  }
  const familyMatch = bibleBook ? SLOT_FAMILIES[slot].has(bibleBook) : null;
  if (familyMatch === false) {
    report.counts.readings.slotFamilyMismatches++;
    review({ kind: "slot_family_mismatch", where, sourceSlot, slot,
      sourceBookTitle: verse.bookTitle ?? null, bibleBook });
  }
  return {
    slot,
    sourceSlot,
    reference: {
      sourceBookTitle: verse.bookTitle ?? null,
      bibleBook,
      familyMatch,
      chapter,
      verseStart: intOrNull(verse.start),
      verseEnd: intOrNull(verse.end),
      endText: verse.endText ?? null,
      endNote: verse.endNote ?? null,
      sourceCitation: verse.citation ?? reading.citation ?? null,
    },
    // Availability flags only: the strings themselves stay in the snapshot
    // until the manifest's rights review permits publishing them.
    textAvailable: {
      geez: Boolean(reading.text?.geez),
      amharic: Boolean(reading.text?.amharic),
      english: Boolean(reading.text?.english),
    },
  };
}

function normalizedServices(entry, where) {
  const services = {};
  for (const [sourceService, service] of Object.entries(entry)) {
    if (!(sourceService in SERVICE_MAP) || !service) continue;
    const normalized = {
      sourceService,
      readings: { psalm: [], gospel: [], paulineEpistle: [], catholicEpistle: [], acts: [] },
      anaphora: [],
    };
    for (const [sourceSlot, value] of Object.entries(service)) {
      if (!SERVICE_SLOTS[sourceService].includes(sourceSlot)) {
        errors.push(`${where}: unknown slot '${sourceSlot}' in service '${sourceService}'`);
        continue;
      }
      if (sourceSlot === "kidassie") {
        normalized.anaphora = (value || []).filter((name) => typeof name === "string");
        continue;
      }
      for (const reading of value || []) {
        normalized.readings[SLOT_MAP[sourceSlot]]
          .push(normalizedReading(reading, sourceSlot, `${where} ${sourceService}`));
      }
    }
    services[SERVICE_MAP[sourceService]] = normalized;
  }
  return services;
}

// ---- Daily -----------------------------------------------------------------

const npmDailyKeys = new Set(upstream.dailyKeys);
const catalogDaily = {};
const seenDaily = new Set();
for (const entry of daily) {
  const match = /^(\d{2})-(\d{2})$/.exec(entry.date || "");
  if (!match) { errors.push(`daily: bad date key '${entry.date}'`); continue; }
  const day = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 13 || day < 1 || day > (month === 13 ? 6 : 30)) {
    errors.push(`daily: impossible Ethiopian date '${entry.date}'`);
    continue;
  }
  if (seenDaily.has(entry.date)) { errors.push(`daily: duplicate date '${entry.date}'`); continue; }
  seenDaily.add(entry.date);
  const fromNpm = npmDailyKeys.has(entry.date);
  report.counts.dailyProvenance[fromNpm ? "npmDerived" : "scanBackfilled"]++;
  const where = `daily ${entry.date}`;
  catalogDaily[`${month}-${day}`] = {
    id: `sinq:daily:${month}-${day}`,
    cycle: "fixed",
    ethiopianMonth: month,
    ethiopianDay: day,
    title: entry.title ?? null,
    synaxariumNoteCount: (entry.snksar || []).length,
    provenance: fromNpm
      ? { matins: "gitsawe-npm", liturgy: "gitsawe-npm", vespers: "eotc-scan-backfill" }
      : { matins: "eotc-scan-backfill", liturgy: "eotc-scan-backfill", vespers: "eotc-scan-backfill" },
    services: normalizedServices(entry, where),
  };
}
const expectedDailyCount = 12 * 30 + 6;
if (seenDaily.size !== expectedDailyCount) {
  errors.push(`daily: expected ${expectedDailyCount} unique Ethiopian dates, found ${seenDaily.size}`);
}

// ---- Seasonal --------------------------------------------------------------

const npmSeasonalKeys = new Set(upstream.seasonalKeys);
const catalogSeasonal = [];
const seenSeasonalIds = new Set();
for (const entry of seasonal) {
  if (!SEASONS.has(entry.season)) {
    errors.push(`seasonal '${entry.raw}': unknown season '${entry.season}'`);
    continue;
  }
  if (!npmSeasonalKeys.has(entry.raw)) {
    review({ kind: "seasonal_key_not_in_npm_dataset", raw: entry.raw });
  }
  const id = `sinq:seasonal:${entry.season}:${entry.week ?? 0}${entry.part != null ? `:${entry.part}` : ""}`;
  if (seenSeasonalIds.has(id)) { errors.push(`seasonal: duplicate id '${id}'`); continue; }
  seenSeasonalIds.add(id);
  catalogSeasonal.push({
    id,
    cycle: "seasonal",
    season: entry.season,
    week: entry.week ?? null,
    part: entry.part ?? null,
    sourceKey: entry.raw,
    movable: entry.movable !== false,
    title: entry.title ?? null,
    provenance: "gitsawe-npm",
    services: normalizedServices(entry, `seasonal ${entry.raw}`),
  });
}

// ---- Monthly ---------------------------------------------------------------

const catalogMonthly = [];
const seenMonthlyIds = new Set();
for (const entry of monthly) {
  if (entry.appliesTo !== "sunday") {
    errors.push(`monthly '${entry.raw}': unsupported appliesTo '${entry.appliesTo}'`);
    continue;
  }
  if (entry.month !== "tsige" && entry.monthNum !== (MONTH_KEYS[entry.month] ?? null)) {
    errors.push(`monthly '${entry.raw}': month '${entry.month}' does not match monthNum ${entry.monthNum}`);
  }
  if (entry.nthSunday == null && entry.fromDay == null) {
    errors.push(`monthly '${entry.raw}': no matching rule (needs nthSunday or fromDay)`);
    continue;
  }
  const span = entry.nthSunday != null ? `sun${entry.nthSunday}` : `d${entry.fromDay}-${entry.toDay ?? entry.fromDay}`;
  const id = `sinq:monthly:${entry.month}:${span}`;
  if (seenMonthlyIds.has(id)) { errors.push(`monthly: duplicate id '${id}'`); continue; }
  seenMonthlyIds.add(id);
  catalogMonthly.push({
    id,
    cycle: "monthly",
    month: entry.month,
    monthNum: entry.monthNum ?? null,
    match: {
      appliesTo: entry.appliesTo,
      fromDay: entry.fromDay ?? null,
      toDay: entry.toDay ?? null,
      nthSunday: entry.nthSunday ?? null,
      crossMonth: entry.crossMonth === true,
    },
    mezmur: entry.mezmur ?? null,
    sourceKey: entry.raw,
    title: entry.title ?? null,
    provenance: "sinq-authored",
    services: normalizedServices(entry, `monthly ${entry.raw}`),
  });
}

// ---- Feast graph -----------------------------------------------------------

const feastKeys = new Set();
const catalogFeasts = [];
const dateKeyUse = new Map();
for (const feast of feasts) {
  if (feastKeys.has(feast.key)) { errors.push(`feasts: duplicate key '${feast.key}'`); continue; }
  feastKeys.add(feast.key);
  let dateKey = null;
  if (!feast.movable) {
    const match = /^(\d{2})-(\d{2})$/.exec(feast.dateKey || "");
    if (!match || Number(match[1]) !== feast.day || Number(match[2]) !== feast.monthNum) {
      errors.push(`feasts '${feast.key}': dateKey '${feast.dateKey}' disagrees with monthNum/day`);
    } else {
      dateKey = `${feast.monthNum}-${feast.day}`;
      dateKeyUse.set(dateKey, [...(dateKeyUse.get(dateKey) || []), feast.key]);
    }
    const amharicDay = geezToInteger(feast.amharicName || "");
    if (amharicDay !== null && amharicDay !== feast.day) {
      review({ kind: "feast_name_day_mismatch", feast: feast.key,
        amharicName: feast.amharicName, amharicNameDay: amharicDay, day: feast.day });
    }
    const englishDay = /\((?:[^)]*?)(\d+)\)/.exec(feast.name || "");
    if (englishDay && Number(englishDay[1]) !== feast.day) {
      review({ kind: "feast_name_day_mismatch", feast: feast.key,
        name: feast.name, nameDay: Number(englishDay[1]), day: feast.day });
    }
  }
  catalogFeasts.push({
    id: `sinq:feast:${feast.key}`,
    sourceKey: feast.key,
    name: feast.name,
    amharicName: feast.amharicName,
    month: feast.month ?? null,
    monthNum: feast.monthNum ?? null,
    day: feast.day ?? null,
    dateKey,
    movable: feast.movable === true,
    provenance: "sinq-authored",
  });
}
for (const [dateKey, keys] of dateKeyUse) {
  if (keys.length > 1) review({ kind: "shared_feast_date_key", dateKey, feasts: keys });
}

const subFeastKeys = new Set();
const catalogSubFeasts = [];
for (const sub of subFeasts) {
  if (subFeastKeys.has(sub.key)) { errors.push(`sub-feasts: duplicate key '${sub.key}'`); continue; }
  subFeastKeys.add(sub.key);
  if (!feastKeys.has(sub.feast)) {
    errors.push(`sub-feasts '${sub.key}': unknown feast '${sub.feast}'`);
    continue;
  }
  catalogSubFeasts.push({
    id: `sinq:subfeast:${sub.key}`,
    sourceKey: sub.key,
    name: sub.name,
    amharicName: sub.amharicName,
    feast: `sinq:feast:${sub.feast}`,
    provenance: "sinq-authored",
  });
}

const catalogMahlets = [];
const mahletIdCount = new Map();
for (const mahlet of mahlets) {
  if (!subFeastKeys.has(mahlet.subFeast)) {
    errors.push(`mahlets '${mahlet.title}': unknown subFeast '${mahlet.subFeast}'`);
    continue;
  }
  const count = (mahletIdCount.get(mahlet.subFeast) || 0) + 1;
  mahletIdCount.set(mahlet.subFeast, count);
  catalogMahlets.push({
    id: `sinq:mahlet:${mahlet.subFeast}${count > 1 ? `:${count}` : ""}`,
    title: mahlet.title,
    subFeast: `sinq:subfeast:${mahlet.subFeast}`,
    chantSource: mahlet.source ?? null,
    // Roles only; the chant verse text is rights-restricted (see manifest).
    chants: (mahlet.detail || []).map((chant) => ({ role: chant.key })),
    chantTextAvailable: (mahlet.detail || []).length > 0,
    provenance: "sinq-authored",
  });
}

// ---- Reconciliation against the fixed scan catalog -------------------------

const CLASS_ORDER = ["exact", "equivalent_numbering", "partial", "conflict", "unavailable"];
function classifyAgainst(reference, candidates) {
  let best = "unavailable";
  const better = (a, b) => CLASS_ORDER.indexOf(a) < CLASS_ORDER.indexOf(b) ? a : b;
  for (const candidate of candidates) {
    const ours = candidate.canonicalReference;
    if (!ours || candidate.bibleBook !== reference.bibleBook) continue;
    let klass;
    if (ours.chapter === reference.chapter) {
      const endMatches = ours.verseEnd === reference.verseEnd
        || (ours.toEndOfChapter && reference.verseEnd === null);
      if (ours.verseStart === reference.verseStart && endMatches) klass = "exact";
      else klass = "partial";
    } else if (reference.bibleBook === "PSA"
        && Math.abs((ours.chapter ?? 0) - (reference.chapter ?? 0)) === 1
        && ours.verseStart === reference.verseStart) {
      klass = "equivalent_numbering";
    } else {
      klass = "conflict";
    }
    best = better(best, klass);
  }
  if (best === "unavailable" && candidates.length > 0
      && candidates.some((candidate) => candidate.canonicalReference)) {
    best = "conflict"; // the scan appoints a different book in this slot group
  }
  return best;
}

const reconciliation = {
  version: 1,
  method: "Per day, service, and slot: the Sinq reference is classified against the scan transcription's readings of the same slot group. exact = book/chapter/verse bounds agree; equivalent_numbering = Psalm chapter off by one with the same start verse; partial = same book and chapter, different or missing verse bounds; conflict = the scan appoints a different chapter or book; unavailable = the scan has no parsed reading for the slot group. Caveat: the vespers office and the 65 scan-backfilled days were imported into Sinq FROM this repository's transcription, so their agreement validates the two parsers' round trip, not independent sources. Only matins/liturgy on the 301 npm-derived days compare genuinely independent data.",
  summary: { byClass: {}, byService: {}, daysCompared: 0 },
  days: [],
};
const bump = (target, key) => { target[key] = (target[key] || 0) + 1; };

for (let month = 1; month <= 13; month++) {
  for (let day = 1; day <= (month === 13 ? 6 : 30); day++) {
    const key = `${month}-${day}`;
    const sinqDay = catalogDaily[key];
    const scanDay = fixedCatalog.days[key];
    if (!sinqDay || !scanDay) continue;
    reconciliation.summary.daysCompared++;
    const dayResult = { date: key, provenance: sinqDay.provenance, services: {} };
    for (const [serviceName, service] of Object.entries(sinqDay.services)) {
      const scanService = scanDay.gitsawe.services[serviceName];
      const slots = [];
      for (const [slot, readings] of Object.entries(service.readings)) {
        for (const reading of readings) {
          if (!reading.reference.bibleBook) continue;
          const candidates = !scanService ? []
            : slot === "psalm" ? scanService.psalms
            : slot === "gospel" ? scanService.gospels
            : scanService.epistlesAndActs;
          const klass = classifyAgainst(reading.reference, candidates || []);
          slots.push({
            slot,
            sinq: {
              book: reading.reference.bibleBook,
              chapter: reading.reference.chapter,
              verseStart: reading.reference.verseStart,
              verseEnd: reading.reference.verseEnd,
            },
            class: klass,
          });
          bump(reconciliation.summary.byClass, klass);
          reconciliation.summary.byService[serviceName] ??= {};
          bump(reconciliation.summary.byService[serviceName], klass);
        }
      }
      if (slots.length) dayResult.services[serviceName] = slots;
    }
    reconciliation.days.push(dayResult);
  }
}

// ---- Outputs ---------------------------------------------------------------

if (errors.length) {
  console.error("compile_sinq_gitsawe: structural validation failed");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

const catalog = {
  version: 1,
  source: {
    dataset: "sinq-gitsawe",
    snapshotRevision: manifest.snapshot.sinqGitRevision,
    upstreamPackage: `${upstream.package}@${upstream.version} (${upstream.license})`,
    textPolicy: "Reading bodies and mahlet chant verse text are excluded pending the rights review recorded in data/sinq-gitsawe/manifest.json; readings carry references and text-availability flags only.",
  },
  daily: catalogDaily,
  seasonal: catalogSeasonal,
  monthly: catalogMonthly,
  feasts: catalogFeasts,
  subFeasts: catalogSubFeasts,
  mahlets: catalogMahlets,
  months: months.map((month) => ({ key: month.key, name: month.name, amharicName: month.amharicName })),
  packages: packages.map((pkg) => ({ key: pkg.key, name: pkg.name })),
};
report.counts.output = {
  daily: Object.keys(catalogDaily).length,
  seasonal: catalogSeasonal.length,
  monthly: catalogMonthly.length,
  feasts: catalogFeasts.length,
  subFeasts: catalogSubFeasts.length,
  mahlets: catalogMahlets.length,
  months: catalog.months.length,
  packages: catalog.packages.length,
};

const reportOut = path.join(root, "data/sinq-gitsawe/quality-report.json");
fs.writeFileSync(reportOut, JSON.stringify(report, null, 2) + "\n");
const reconciliationOut = path.join(root, "data/sinq-gitsawe/reconciliation-report.json");
fs.writeFileSync(reconciliationOut, JSON.stringify(reconciliation, null, 2) + "\n");
// Lives beside gitsawe_catalog.js for the same reason: Python wheels bundle it,
// and the TypeScript Worker imports the identical file.
const catalogOut = path.join(root, "py/eotc/sinq_catalog.js");
fs.writeFileSync(catalogOut, `export default ${JSON.stringify(catalog)};\n`);

console.log(`wrote ${path.relative(root, reportOut)}`);
console.log(`wrote ${path.relative(root, reconciliationOut)}`);
console.log(`wrote ${path.relative(root, catalogOut)}`);
console.log(`Sinq catalog: ${report.counts.output.daily} daily, ${report.counts.output.seasonal} seasonal, ${report.counts.output.monthly} monthly, ${report.counts.output.feasts} feasts, ${report.counts.output.subFeasts} sub-feasts, ${report.counts.output.mahlets} mahlets`);
console.log(`Readings: ${report.counts.readings.normalized} normalized, ${report.counts.readings.unresolvedBooks} unresolved books, ${report.counts.readings.slotFamilyMismatches} family mismatches`);
console.log(`Reconciliation: ${JSON.stringify(reconciliation.summary.byClass)}`);
