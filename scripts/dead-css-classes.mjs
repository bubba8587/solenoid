// Lists CSS class selectors that nothing in the source emits (a removed renderer's classes match
// silently). Buckets: A, no source mentions it; B, only class readers (census, tests) mention it;
// C, a BEM suffix a template may compose at runtime, to check by hand. Substring matching counts a
// class named in a comment as emitted, so A under-reports. Writes nothing.
//   node scripts/dead-css-classes.mjs [srcDir]
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

// Strip comments and declaration bodies first, so a `.foo` in a data URI or content string isn't a selector.
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
const RENDERS = new Set(
  [...srcText]
    .filter(([f, t]) =>
      !/\.test\.tsx?$/.test(f) && !/\.md$/.test(f) &&
      /className|class=|classList\.(add|toggle|replace)|setAttribute\(\s*["']class["']/.test(t))
    .map(([f]) => f),
);

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
