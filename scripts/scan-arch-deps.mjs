// Scans a source tree for relative-import edges — the derived data behind the
// Architecture map's dependency cables. vite.config.ts serves the result as the
// `virtual:arch-deps` module (SSOT-3: the map draws the imports the code
// actually has, never a hand-kept list); archDeps.test.ts runs the same scan
// directly against src/graph.
import * as fs from "node:fs";
import * as path from "node:path";

// Static `import … from "./x"`, `export … from "./x"`, and dynamic `import("./x")`,
// relative specifiers only (package imports are not architecture edges).
const IMPORT_RE =
  /(?:^|\n)\s*(?:import|export)\s[^;'"]*?from\s+["'](\.{1,2}\/[^"']+)["']|\bimport\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;

/**
 * Walk `rootDir` for .ts/.tsx sources (tests excluded) and resolve every
 * relative import that lands on another file in the set. Paths are
 * root-relative POSIX; output is sorted so the result is build-stable.
 */
export function scanArchDeps(rootDir) {
  const abs = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) abs.push(p);
    }
  })(rootDir);
  const rel = (p) => path.relative(rootDir, p).split(path.sep).join("/");
  const files = abs.map(rel).sort();
  const fileSet = new Set(files);

  const imports = {};
  for (const p of abs) {
    const from = rel(p);
    const src = fs.readFileSync(p, "utf8");
    const out = new Set();
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = (m[1] ?? m[2]).replace(/\?.*$/, "");
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
      for (const cand of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
        if (fileSet.has(cand)) { out.add(cand); break; }
      }
    }
    out.delete(from);
    imports[from] = [...out].sort();
  }
  return { files, imports };
}
