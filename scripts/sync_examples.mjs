/**
 * Inline the runnable files in examples/ into the integration guides.
 *
 * The documentation must never show code that does not run. Each snippet is
 * delimited by markers naming its source file, and this script rewrites the
 * block between them from that file. `make check-generated` then fails if a
 * committed guide does not match, so a snippet cannot drift away from the
 * example that CI actually executes.
 *
 * Markdown targets carry a fenced block:
 *
 *   <!-- example:examples/today.js -->
 *   ```javascript
 *   ...replaced...
 *   ```
 *   <!-- /example -->
 *
 * HTML targets carry a <pre><code> block, and the source is entity-escaped:
 *
 *   <!-- example:examples/today.js -->
 *   <pre><code>...replaced...</code></pre>
 *   <!-- /example -->
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const targets = ["docs/INTEGRATION.md", "web/docs/integration.html"];

const FENCE = { ".js": "javascript", ".py": "python" };
const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const MARKDOWN = /(<!-- example:(\S+) -->\n)```[a-z]*\n[\s\S]*?```(\n<!-- \/example -->)/g;
const HTML = /(<!-- example:(\S+) -->\n)<pre><code>[\s\S]*?<\/code><\/pre>(\n<!-- \/example -->)/g;

let total = 0;
for (const target of targets) {
  const file = path.join(root, target);
  const original = readFileSync(file, "utf8");
  const isHtml = target.endsWith(".html");
  let count = 0;

  const updated = original.replace(isHtml ? HTML : MARKDOWN, (_match, open, source, close) => {
    const code = readFileSync(path.join(root, source), "utf8").trimEnd();
    count++;
    if (isHtml) return `${open}<pre><code>${escapeHtml(code)}</code></pre>${close}`;
    const language = FENCE[path.extname(source)] ?? "";
    return `${open}\`\`\`${language}\n${code}\n\`\`\`${close}`;
  });

  if (original !== updated) writeFileSync(file, updated);
  console.log(`  ${target}: ${count} snippet(s) ${original === updated ? "unchanged" : "updated"}`);
  total += count;
}
console.log(`sync_examples: ${total} snippet(s) across ${targets.length} target(s)`);
