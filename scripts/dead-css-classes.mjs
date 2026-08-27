// Static sweep for CSS class selectors NOTHING in the source emits — the shape of
// breakage the React Flow port leaves behind. A removed render package took its DOM
// with it (rete's classic preset wrapped every socket in .input-socket/.output-socket),
// and the CSS keyed on those classes stopped matching in silence: no error, no failing
// test, just an element that quietly renders as nothing.
//
//   node scripts/dead-css-classes.mjs [srcDir]
//
// Three buckets, most damning first:
//   A  no source file mentions it at all
//   B  mentioned, but only by files that READ classes (census, tests) — never emitted
//   C  a BEM suffix a template literal probably composes at runtime — verify by hand
//
// Substring matching, so a class named only in a COMMENT counts as emitted: bucket A
// under-reports rather than crying wolf. Pure measurement; nothing is written.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = process.argv[2] ?? "src";
const walk = (d, out = []) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};
const files = walk(ROOT);
const cssFiles = files.filter((f) => extname(f) === ".css");
const srcFiles = files.filter((f) => [".ts", ".tsx", ".js", ".jsx", ".html", ".md", ".json"].includes(extname(f)));

// Every class token in a SELECTOR position. Comments and declaration bodies go first,
// so a `.foo` inside a mask data-URI or a content string can't read as a selector.
const classesByFile = new Map();
for (const f of cssFiles) {
  const selectorText = readFileSync(f, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{[^{}]*\}/g, "{}");
  for (const m of selectorText.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
    if (!classesByFile.has(m[1])) classesByFile.set(m[1], new Set());
    classesByFile.get(m[1]).add(f);
  }
}

const srcText = new Map();
for (const f of [...srcFiles, "index.html"]) {
  try { srcText.set(f, readFileSync(f, "utf8")); } catch { /* not there */ }
}
// A file that can put a class INTO the DOM. Anything else (census.ts, tests, docs) only
// reads one, so a mention there is not evidence the class is ever emitted.
const RENDERS = new Set(
  [...srcText]
    .filter(([f, t]) =>
      !/\.test\.tsx?$/.test(f) && !/\.md$/.test(f) &&
      /className|class=|classList\.(add|toggle|replace)|setAttribute\(\s*["']class["']/.test(t))
    .map(([f]) => f),
);

// Namespaces the library writes into the DOM, not our source.
const VENDOR = [/^react-flow/, /^xy-/, /^katex/, /^mermaid/, /^cm-/, /^hljs/, /^tippy/, /^rete/, /^recharts/, /^decorum/];
const renderMention = (s) => [...srcText].some(([f, t]) => RENDERS.has(f) && t.includes(s));
const composed = (cls) =>
  // BEM separators only: splitting on a bare "-" matches almost anything.
  ["--", "__"].some((sep) => {
    const i = cls.lastIndexOf(sep);
    return i > 0 && renderMention(cls.slice(0, i)) && renderMention(cls.slice(i));
  });

const A = [], B = [], C = [];
for (const [cls, css] of classesByFile) {
  if (VENDOR.some((r) => r.test(cls))) continue;
  const seen = [...srcText].filter(([, t]) => t.includes(cls)).map(([f]) => f);
  if (seen.some((f) => RENDERS.has(f))) continue;
  const row = { cls, css: [...css], seen };
  (seen.length ? B : composed(cls) ? C : A).push(row);
}
const show = (label, rows, withSeen) => {
  console.log(`\n── ${label} (${rows.length}) ──`);
  for (const r of rows.sort((a, b) => a.cls.localeCompare(b.cls))) {
    console.log(`  .${r.cls.padEnd(44)} ${r.css.join(", ")}`);
    if (withSeen && r.seen.length) console.log(`${" ".repeat(6)}only mentioned in: ${r.seen.join(", ")}`);
  }
};
console.log(`${cssFiles.length} css files, ${classesByFile.size} distinct classes`);
show("A. nothing emits it, nothing mentions it", A, false);
show("B. mentioned but never emitted — read-only leftovers", B, true);
show("C. probably composed at runtime — verify by hand", C, false);
