// Publish the site's Bible reader data: web/bible/am-1980/{BOOK}.json.
//
// The reader text is a verbatim, per-book copy of the am-1980 edition
// (80-weahadu, CC BY-NC-ND 4.0). It is deliberately NOT part of the MIT API
// or its packages: the site redistributes the unchanged text non-commercially
// with attribution, which is what its license permits, and web/bible/ carries
// the license and notice alongside the data. When data/bible/ is absent
// (CI), the committed reader files are left untouched.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(root, "web/bible/am-1980");
const bibleDir = path.join(root, "data/bible");

if (!fs.existsSync(path.join(bibleDir, "canon.json"))) {
  if (!fs.existsSync(path.join(outDir, "index.json"))) {
    console.error("build_bible_reader: data/bible/ absent and no committed reader data exists yet.");
    process.exit(1);
  }
  console.log("note: data/bible/ absent (licensed, local-only); keeping committed reader data");
  process.exit(0);
}

const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const canon = read("data/bible/canon.json");
const namesAm = read("data/sinq-gitsawe/names-am.json");
const editions = read("data/bible/editions.json").editions.filter((e) => e.id === "am-1980");

fs.mkdirSync(outDir, { recursive: true });

const index = [];
for (const entry of canon.sort((a, b) => a.order - b.order)) {
  const file = path.join(bibleDir, "am-1980/books", entry.file);
  if (!fs.existsSync(file)) continue;
  const book = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!book.chapters?.length) continue;
  const names = namesAm[entry.id] || {};
  const slim = {
    id: entry.id,
    name: names.name ?? entry.name_en,
    nameEn: entry.name_en,
    abbr: names.abbr ?? entry.id,
    chapters: book.chapters.map((chapter) =>
      chapter.verses.map((verse) => ({ n: verse.n, a: verse.alt ?? null, t: verse.t }))),
  };
  fs.writeFileSync(path.join(outDir, `${entry.id}.json`), JSON.stringify(slim) + "\n");
  index.push({ id: entry.id, name: slim.name, nameEn: slim.nameEn, abbr: slim.abbr, chapters: slim.chapters.length });
}

fs.writeFileSync(path.join(outDir, "index.json"), JSON.stringify({
  edition: {
    id: "am-1980",
    title: editions[0]?.title ?? "መጽሐፍ ቅዱስ ሰማንያ አሐዱ በአማርኛ",
    publisher: editions[0]?.publisher ?? null,
    license: "CC-BY-NC-ND-4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-nc-nd/4.0/",
    source: "EOTCOpenSource/80-weahadu",
    notice: "Verse text reproduced unchanged, redistributed non-commercially with attribution. Not part of the MIT-licensed API.",
  },
  books: index,
}) + "\n");

fs.writeFileSync(path.join(root, "web/bible/NOTICE"), `The files under web/bible/ are third-party scripture text and are NOT under
the repository's MIT license.

am-1980: መጽሐፍ ቅዱስ ሰማንያ አሐዱ በአማርኛ (Amharic Bible, 81 books, 1980 EC edition)
Source: 80-weahadu, EOTCOpenSource (https://github.com/EOTCOpenSource/80-weahadu)
License: Creative Commons Attribution-NonCommercial-NoDerivatives 4.0
         (https://creativecommons.org/licenses/by-nc-nd/4.0/)

The verse text is reproduced unchanged and served non-commercially with
attribution by the project website's reader. Redistributors must satisfy the
license independently; forking this repository does not grant MIT rights over
these files.
`);

console.log(`wrote ${index.length} books + index.json + NOTICE to web/bible/am-1980`);
