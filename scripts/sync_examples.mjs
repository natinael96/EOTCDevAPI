/**
 * Inline the files in examples/ into the integration guides.
 *
 * The documentation must never show code that does not run. Each snippet is
 * delimited by markers naming its source file, and this script rewrites the
 * block between them from that file. `make check-generated` then fails if a
 * committed guide does not match, so a snippet cannot drift away from the
 * example that CI executes.
 *
 * Markdown keeps a plain fenced block, because the renderers that display it
 * highlight fenced code themselves. HTML is highlighted here instead, at build
 * time: the published page then needs no highlighting library, no network
 * request, and no client-side work to colour a block.
 *
 *   <!-- example:examples/today.js -->
 *   <pre><code>...replaced...</code></pre>
 *   <!-- /example -->
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const targets = ["docs/INTEGRATION.md", "web/docs/integration.html"];

const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---- Syntax highlighting ---------------------------------------------------
// A deliberately small scanner. It covers what these examples actually contain
// -- comments, strings, numbers, keywords, and call names -- and nothing more.
// Anything it does not recognize is emitted as plain text, so an unhandled
// construct loses colour rather than breaking the page.

const COMMON = ["return", "if", "else", "for", "while", "in", "of", "new", "class",
  "import", "from", "try", "catch", "throw", "true", "false", "null", "as"];
const SPECS = {
  js: {
    line: "//", block: ["/*", "*/"], quotes: ["'", '"', "`"],
    keywords: [...COMMON, "const", "let", "var", "function", "await", "async", "process",
      "await", "typeof", "instanceof", "undefined", "this"],
  },
  py: {
    line: "#", triples: ['"""', "'''"], quotes: ["'", '"'],
    keywords: [...COMMON, "def", "elif", "not", "and", "or", "is", "None", "True", "False",
      "with", "lambda", "pass", "raise", "except", "print", "self"],
  },
  kt: {
    line: "//", block: ["/*", "*/"], quotes: ['"'],
    keywords: [...COMMON, "val", "var", "fun", "data", "private", "object", "override",
      "apply", "use", "String", "Int", "Boolean", "List"],
  },
  swift: {
    line: "//", block: ["/*", "*/"], quotes: ['"'],
    keywords: [...COMMON, "let", "var", "func", "struct", "guard", "async", "throws",
      "await", "String", "Int", "Bool", "Decodable", "self"],
  },
};
const LANGUAGE = { ".js": "js", ".py": "py", ".kt": "kt", ".swift": "swift" };
const FENCE = { ".js": "javascript", ".py": "python", ".kt": "kotlin", ".swift": "swift" };

const span = (cls, text) => `<span class="${cls}">${escapeHtml(text)}</span>`;

/** Consume a quoted string starting at `i`, honouring backslash escapes. */
function readString(code, i, quote) {
  let j = i + quote.length;
  while (j < code.length) {
    if (code[j] === "\\") { j += 2; continue; }
    if (code.startsWith(quote, j)) return j + quote.length;
    j++;
  }
  return code.length;
}

function highlight(code, language) {
  const spec = SPECS[language];
  if (!spec) return escapeHtml(code);
  let out = "";
  let i = 0;
  while (i < code.length) {
    const rest = code.slice(i);

    // Triple-quoted Python blocks are documentation in these files, so they read
    // as comments rather than as the strings they technically are.
    const triple = (spec.triples ?? []).find((q) => rest.startsWith(q));
    if (triple) {
      const end = readString(code, i, triple);
      out += span("cm", code.slice(i, end));
      i = end;
      continue;
    }
    if (spec.block && rest.startsWith(spec.block[0])) {
      const close = code.indexOf(spec.block[1], i + spec.block[0].length);
      const end = close === -1 ? code.length : close + spec.block[1].length;
      out += span("cm", code.slice(i, end));
      i = end;
      continue;
    }
    if (rest.startsWith(spec.line)) {
      const newline = code.indexOf("\n", i);
      const end = newline === -1 ? code.length : newline;
      out += span("cm", code.slice(i, end));
      i = end;
      continue;
    }
    const quote = spec.quotes.find((q) => rest.startsWith(q));
    if (quote) {
      const end = readString(code, i, quote);
      out += span("s", code.slice(i, end));
      i = end;
      continue;
    }
    const annotation = /^@\w+/.exec(rest);
    if (annotation) {
      out += span("at", annotation[0]);
      i += annotation[0].length;
      continue;
    }
    const number = /^\d[\d_]*(?:\.\d+)?/.exec(rest);
    if (number) {
      out += span("n", number[0]);
      i += number[0].length;
      continue;
    }
    const word = /^[A-Za-z_$][\w$]*/.exec(rest);
    if (word) {
      const name = word[0];
      // A name immediately followed by "(" is being called or declared.
      const called = /^\s*\(/.test(code.slice(i + name.length));
      if (spec.keywords.includes(name)) out += span("k", name);
      else if (called) out += span("fn", name);
      else out += escapeHtml(name);
      i += name.length;
      continue;
    }
    out += escapeHtml(code[i]);
    i++;
  }
  return out;
}

// ---- Inlining --------------------------------------------------------------

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
    const extension = path.extname(source);
    count++;
    if (isHtml) {
      return `${open}<pre><code>${highlight(code, LANGUAGE[extension])}</code></pre>${close}`;
    }
    return `${open}\`\`\`${FENCE[extension] ?? ""}\n${code}\n\`\`\`${close}`;
  });

  if (original !== updated) writeFileSync(file, updated);
  console.log(`  ${target}: ${count} snippet(s) ${original === updated ? "unchanged" : "updated"}`);
  total += count;
}
console.log(`sync_examples: ${total} snippet(s) across ${targets.length} target(s)`);
