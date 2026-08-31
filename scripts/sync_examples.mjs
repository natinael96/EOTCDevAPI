/**
 * Inline the runnable files in examples/ into docs/INTEGRATION.md.
 *
 * The documentation must never show code that does not run. Each snippet in the
 * guide is delimited by markers naming its source file, and this script rewrites
 * the fenced block between them from that file. `make check-generated` then
 * fails if the committed document does not match, so a snippet cannot drift away
 * from the example that CI actually executes.
 *
 *   <!-- example:examples/today.js -->
 *   ```javascript
 *   ...replaced...
 *   ```
 *   <!-- /example -->
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const docPath = path.join(root, "docs/INTEGRATION.md");
const doc = readFileSync(docPath, "utf8");

const FENCE = { ".js": "javascript", ".py": "python" };
const pattern = /(<!-- example:(\S+) -->\n)```[a-z]*\n[\s\S]*?```(\n<!-- \/example -->)/g;

let replaced = 0;
const out = doc.replace(pattern, (_match, open, file, close) => {
  const source = readFileSync(path.join(root, file), "utf8").trimEnd();
  const language = FENCE[path.extname(file)] ?? "";
  replaced++;
  return `${open}\`\`\`${language}\n${source}\n\`\`\`${close}`;
});

if (doc !== out) writeFileSync(docPath, out);
console.log(`sync_examples: ${replaced} snippet(s) inlined into docs/INTEGRATION.md`
  + (doc === out ? " (unchanged)" : " (updated)"));
