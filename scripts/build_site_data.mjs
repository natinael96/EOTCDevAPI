// Emit web/daily.json: for every Ethiopian month-day, the Sinksar annual and
// monthly commemoration titles plus the day's Gitsawe reading references,
// rendered with Amharic book abbreviations. Derived from the same generated
// catalogs the API serves, so the site can never drift from it.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const loadCatalog = (file) => JSON.parse(
  fs.readFileSync(path.join(root, file), "utf8")
    .replace(/^export default /, "").replace(/;\s*$/, ""),
);
const catalog = loadCatalog("py/eotc/gitsawe_catalog.js");
const bible = loadCatalog("py/eotc/bible_catalog.js");

const abbr = new Map(bible.books.map((book) => [book.id, book.names.amharicAbbreviation || book.id]));

function refObject(reading) {
  const ref = reading.canonicalReference;
  if (ref && ref.chapter) {
    let display = (abbr.get(ref.book) ?? ref.book) + " " + ref.chapter;
    if (ref.verseStart) {
      display += ":" + ref.verseStart;
      if (ref.verseEnd && ref.verseEnd !== ref.verseStart) display += "-" + ref.verseEnd;
      else if (ref.toEndOfChapter) display += " እስከ ፍጻሜ";
    }
    const out = { t: display, b: ref.book, c: ref.chapter };
    if (ref.verseStart) out.v = ref.verseStart;
    if (ref.verseEnd) out.e = ref.verseEnd;
    if (ref.toEndOfChapter) out.f = true;
    return out;
  }
  // Unresolved citation: fall back to the printed source label, unlinkable.
  const source = [reading.sourceBook, reading.sourceCitation].filter(Boolean).join(" ").trim();
  return source ? { t: source } : null;
}

function serviceRefs(service) {
  if (!service) return null;
  const first = (list) => (list && list.length ? refObject(list[0]) : null);
  const out = {
    psalm: first(service.psalms),
    gospel: first(service.gospels),
  };
  const epistles = (service.epistlesAndActs ?? []).map(refObject).filter(Boolean);
  if (epistles.length) out.epistles = epistles;
  if (service.anaphora) out.anaphora = service.anaphora.replace(/\s*[።፡]\s*$/, "");
  return out;
}

const out = {};
for (const [key, day] of Object.entries(catalog.days)) {
  const sinksar = day.sinksar;
  const services = day.gitsawe.services;
  out[key] = {
    annual: sinksar ? sinksar.annualFeasts.items.map((item) => item.title) : [],
    monthly: sinksar ? sinksar.monthlyFeasts.items.map((item) => item.title) : [],
    readings: {
      matins: serviceRefs(services.matins),
      liturgy: serviceRefs(services.liturgy),
      vespers: serviceRefs(services.vespers),
    },
  };
}

const file = path.join(root, "web/daily.json");
fs.writeFileSync(file, JSON.stringify(out) + "\n");
console.log(`wrote ${path.relative(root, file)} (${Object.keys(out).length} days, ${fs.statSync(file).size} bytes)`);

const legacy = path.join(root, "web/sinksar.json");
if (fs.existsSync(legacy)) {
  fs.rmSync(legacy);
  console.log("removed web/sinksar.json (superseded by daily.json)");
}
