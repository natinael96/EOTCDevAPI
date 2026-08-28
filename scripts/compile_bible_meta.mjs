// Compile the committed Bible metadata catalog (py/eotc/bible_catalog.js)
// from the licensed local editions in data/bible/.
//
// The catalog holds facts only: canon order, book identity, localized names,
// chapter counts, and per-chapter verse counts under the am-1980
// versification. No verse text enters the artifact; the editions themselves
// are licensed out of the repository (CC BY-NC-ND) and absent in CI, so when
// data/bible/ is missing this script verifies the committed artifact exists
// and exits without rewriting anything.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "py/eotc/bible_catalog.js");
const bibleDir = path.join(root, "data/bible");

if (!fs.existsSync(path.join(bibleDir, "canon.json"))) {
  if (!fs.existsSync(out)) {
    console.error("compile_bible_meta: data/bible/ is absent and py/eotc/bible_catalog.js does not exist yet.");
    console.error("Generate the catalog once on a machine that has the local editions.");
    process.exit(1);
  }
  console.log("note: data/bible/ absent (licensed, local-only); keeping committed bible_catalog.js");
  process.exit(0);
}

const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const canon = read("data/bible/canon.json");
const editionsFile = read("data/bible/editions.json");
const namesAm = read("data/sinq-gitsawe/names-am.json");

const editionBooks = (edition) => {
  const dir = path.join(bibleDir, edition, "books");
  const byId = new Map();
  for (const file of fs.readdirSync(dir).sort()) {
    const book = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    byId.set(book.book, book);
  }
  return byId;
};
const am = editionBooks("am-1980");
const gez = editionBooks("gez-1980");

const books = canon
  .filter((entry) => am.has(entry.id))
  .sort((a, b) => a.order - b.order)
  .map((entry) => {
    const amBook = am.get(entry.id);
    const names = namesAm[entry.id] || null;
    return {
      id: entry.id,
      order: entry.order,
      slug: entry.slug,
      testament: entry.testament ?? null,
      section: entry.section ?? null,
      names: {
        english: entry.name_en ?? null,
        amharic: names?.name ?? null,
        amharicAbbreviation: names?.abbr ?? null,
      },
      chapters: amBook.chapters.length,
      // Per-chapter verse counts under the am-1980 versification. Counts are
      // facts about the edition's division, not its text.
      verseCounts: amBook.chapters.map((chapter) => chapter.verses.length),
      textEditions: { "am-1980": true, "gez-1980": gez.has(entry.id) },
    };
  });

const WANTED_EDITIONS = new Set(["am-1980", "gez-1980"]);
const editions = editionsFile.editions
  .filter((edition) => WANTED_EDITIONS.has(edition.id))
  .map((edition) => ({
    id: edition.id,
    title: edition.title,
    titleEnglish: edition.title_en,
    language: edition.language,
    script: edition.script,
    year: edition.year,
    era: edition.era,
    canon: edition.canon,
    publisher: edition.publisher ?? null,
    license: "CC-BY-NC-ND-4.0",
    source: "EOTCOpenSource/80-weahadu",
    note: "Verse text is not bundled with the MIT runtime; self-hosted deployments with the edition present locally can serve it.",
  }));

const catalog = {
  version: 1,
  versification: "am-1980",
  canonNote: "Books follow the EOTC 81-book canon counting tradition; this edition divides them into the files listed here.",
  books,
  editions,
};

fs.writeFileSync(out, `export default ${JSON.stringify(catalog)};\n`);
console.log(`wrote ${path.relative(root, out)} (${books.length} books, ${editions.length} editions)`);
