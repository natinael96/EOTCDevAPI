import fs from "node:fs";
import path from "node:path";
import { canonicalBookId, geezToInteger, normalizeReadingField, parseCitation } from "./gitsawe_lib.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const report = {
  version: 1,
  gitsawe: { months: 0, days: 0, services: 0, readings: 0, alternateReadings: 0 },
  sinksar: { months: 0, days: 0, entries: 0 },
  bibleLinks: { resolvedBooks: 0, unresolvedBooks: 0, parsedCitations: 0, incompleteCitations: 0 },
  warnings: [],
};
const manifest = read("data/gitsawe/manifest.json");
const catalog = { version: 1, coverage: manifest.gitsawe.coverage, days: {} };

function normalizedReading(reading, fieldType, inheritedBook = null) {
  const sourceBook = reading.book || reading.reading_type || "";
  const book = fieldType === "mezmur" ? "PSA"
    : canonicalBookId(sourceBook) || inheritedBook;
  const citation = parseCitation(reading.chapter_verse);
  return {
    sourceBook,
    bibleBook: book,
    sourceCitation: citation.source,
    canonicalReference: book && citation.chapter ? {
      book,
      chapter: citation.chapter,
      verseStart: citation.verseStart,
      verseEnd: citation.verseEnd,
      toEndOfChapter: citation.toEndOfChapter,
      method: "printed_citation",
      confidence: citation.verseStart ? "probable" : "unresolved",
    } : null,
  };
}

function normalizedServices(services) {
  const names = { "ዘነግህ": "matins", "ዘቅዳሴ": "liturgy", "ዘሠርክ": "vespers" };
  const result = {};
  for (const [sourceService, service] of Object.entries(services || {})) {
    const normalizedService = { sourceService, psalms: [], gospels: [], epistlesAndActs: [], anaphora: null };
    for (const [sourceField, value] of Object.entries(service || {})) {
      const field = normalizeReadingField(sourceField);
      if (field.type === "anaphora") {
        normalizedService.anaphora = value;
      } else if (field.type === "epistles_and_acts") {
        let previousBook = null;
        for (const reading of value || []) {
          const normalized = normalizedReading(reading, field.type, previousBook);
          normalizedService.epistlesAndActs.push({ sourceField, alternate: normalizeReadingField(reading.reading_type).alternate, ...normalized });
          if (normalized.bibleBook) previousBook = normalized.bibleBook;
        }
      } else if (value && typeof value === "object") {
        const normalized = { sourceField, alternate: field.alternate, ...normalizedReading(value, field.type) };
        if (field.type === "mezmur") normalizedService.psalms.push(normalized);
        else if (field.type === "gospel") normalizedService.gospels.push(normalized);
      }
    }
    result[names[sourceService] || sourceService] = normalizedService;
  }
  return result;
}

const expectedDays = (month) => month === 13 ? 6 : 30;
for (const file of fs.readdirSync(path.join(root, "data/gitsawe")).filter((x) => /^\d{2}-.*\.json$/.test(x)).sort()) {
  const data = read(`data/gitsawe/${file}`);
  report.gitsawe.months++;
  if (data.days.length !== expectedDays(data.month_index)) {
    report.warnings.push(`${file}: expected ${expectedDays(data.month_index)} days, found ${data.days.length}`);
  }
  data.days.forEach((day, index) => {
    report.gitsawe.days++;
    const number = geezToInteger(day.day_number);
    if (number !== index + 1) report.warnings.push(`${file}: day ${index + 1} is labelled ${day.day_number}`);
    catalog.days[`${data.month_index}-${index + 1}`] = {
      ethiopianMonth: data.month_index,
      ethiopianDay: index + 1,
      season: data.season,
      gitsawe: {
        cycle: "fixed",
        commemoration: day.commemoration,
        sourceScanPages: day.source_scan_pages || null,
        sourceMonthScanRange: data.scan_pages,
        sourceMonthPrintedRange: data.printed_pages,
        services: normalizedServices(day.services),
      },
      sinksar: null,
    };
    for (const [serviceName, service] of Object.entries(day.services || {})) {
      report.gitsawe.services++;
      for (const [sourceField, value] of Object.entries(service || {})) {
        const field = normalizeReadingField(sourceField);
        if (field.type === "unknown") report.warnings.push(`${file} day ${index + 1}: unknown field ${sourceField}`);
        if (field.alternate) report.gitsawe.alternateReadings++;
        if (field.type === "anaphora") continue;
        const readings = field.type === "epistles_and_acts" ? value : [value];
        let previousBook = null;
        for (const reading of readings || []) {
          if (!reading || typeof reading !== "object") continue;
          report.gitsawe.readings++;
          const sourceBook = reading.book || reading.reading_type;
          // A Psalm field is unambiguous even when its printed book label is
          // damaged. In epistle lists, `ዓዲ` means "again" and inherits the
          // immediately preceding book (normally a second passage from Acts).
          const book = field.type === "mezmur" ? "PSA"
            : canonicalBookId(sourceBook) || (normalizeReadingField(sourceBook).alternate ? previousBook : null);
          if (book) report.bibleLinks.resolvedBooks++;
          else {
            report.bibleLinks.unresolvedBooks++;
            report.warnings.push(`${file} day ${index + 1} ${serviceName}: unresolved book '${sourceBook || ""}'`);
          }
          const citation = parseCitation(reading.chapter_verse);
          if (citation.chapter && citation.verseStart) report.bibleLinks.parsedCitations++;
          else report.bibleLinks.incompleteCitations++;
          if (book) previousBook = book;
        }
      }
    }
  });
}

for (let month = 1; month <= 13; month++) {
  const data = read(`data/sinksar/${month}.json`);
  report.sinksar.months++;
  if (data.month !== month) report.warnings.push(`sinksar/${month}.json: month is ${data.month}`);
  if (data.days.length !== expectedDays(month)) {
    report.warnings.push(`sinksar/${month}.json: expected ${expectedDays(month)} days, found ${data.days.length}`);
  }
  data.days.forEach((day, index) => {
    report.sinksar.days++;
    report.sinksar.entries += day.entries.length;
    if (day.day !== index + 1) report.warnings.push(`sinksar/${month}.json: expected day ${index + 1}, found ${day.day}`);
    const catalogDay = catalog.days[`${month}-${day.day}`];
    if (catalogDay) catalogDay.sinksar = {
      entryCount: day.entries.length,
      entries: day.entries.map((entry, entryIndex) => ({
        id: `${month}-${day.day}-${entryIndex + 1}`,
        type: entry.title.startsWith("📌") ? "calendar_summary"
          : entry.title.startsWith("📖") ? "scripture_note"
          : entryIndex === 0 && entry.title.startsWith("ስንክሳር") ? "day_heading"
          : "narrative",
        title: entry.title,
      })),
      fullTextAvailable: false,
      reason: "Full-text publication rights are not yet recorded.",
    };
  });
}

const out = path.join(root, "data/gitsawe/quality-report.json");
fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
// Keep the one generated runtime artifact inside the Python package so wheels
// include it; the TypeScript Worker imports this exact same file.
const catalogOut = path.join(root, "py/eotc/gitsawe_catalog.js");
fs.writeFileSync(catalogOut, `export default ${JSON.stringify(catalog)};\n`);
console.log(`wrote ${path.relative(root, out)}`);
console.log(`wrote ${path.relative(root, catalogOut)}`);
console.log(`Gitsawe: ${report.gitsawe.days} days, ${report.gitsawe.readings} readings`);
console.log(`Sinksar: ${report.sinksar.days} days, ${report.sinksar.entries} entries`);
console.log(`Bible book links: ${report.bibleLinks.resolvedBooks} resolved, ${report.bibleLinks.unresolvedBooks} unresolved`);
console.log(`Warnings: ${report.warnings.length}`);

if (report.gitsawe.days !== 366 || report.sinksar.days !== 366) process.exitCode = 1;
