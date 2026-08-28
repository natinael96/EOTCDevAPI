// Emit web/sinksar.json: the day-keyed Sinksar annual/monthly commemoration
// titles the static site's "today" panel renders. Derived from the same
// generated catalog the API serves, so the site can never drift from it.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const catalog = JSON.parse(
  fs.readFileSync(path.join(root, "py/eotc/gitsawe_catalog.js"), "utf8")
    .replace(/^export default /, "").replace(/;\s*$/, ""),
);

const out = {};
for (const [key, day] of Object.entries(catalog.days)) {
  const sinksar = day.sinksar;
  if (!sinksar) continue;
  out[key] = {
    annual: sinksar.annualFeasts.items.map((item) => item.title),
    monthly: sinksar.monthlyFeasts.items.map((item) => item.title),
  };
}

const file = path.join(root, "web/sinksar.json");
fs.writeFileSync(file, JSON.stringify(out) + "\n");
console.log(`wrote ${path.relative(root, file)} (${Object.keys(out).length} days, ${fs.statSync(file).size} bytes)`);
