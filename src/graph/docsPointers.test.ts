import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

// The docs are load-bearing for agent sessions (CLAUDE.md "Docs map",
// README's routing table), and pointer drift was the dominant rot found in the
// 2026-08-07 cutdown: docs citing moved/archived/deleted files read as current
// truth. This suite makes the whole class a CI failure:
//  1. every live doc under docs/ appears in the docs/README.md index;
//  2. every `*.md` path cited from a live doc resolves to a real file;
//  3. every archived doc is listed in docs/archive/README.md;
//  4. every code file the README index cites exists in the repo;
//  5. the routing table never sends live work into docs/archive.

const ROOT = path.resolve(__dirname, "../..");
const DOCS = path.join(ROOT, "docs");
const ARCHIVE = path.join(DOCS, "archive");

const read = (p: string) => fs.readFileSync(p, "utf8");
const mdFiles = (dir: string) =>
  fs.readdirSync(dir).filter((f) => f.endsWith(".md"));

const liveDocs = mdFiles(DOCS).map((f) => path.join(DOCS, f));
const v2Docs = mdFiles(path.join(DOCS, "v2.0")).map((f) => path.join(DOCS, "v2.0", f));
const scanned = [
  ...liveDocs,
  ...v2Docs,
  path.join(ROOT, "CLAUDE.md"),
  path.join(ROOT, "DESIGN.md"),
  path.join(ARCHIVE, "README.md"),
];

// Backticked `path/to/file.md` and markdown-link (path/to/file.md) citations.
// Globs (`*`) are skipped; anchors/queries are stripped.
function mdCitations(text: string): string[] {
  const out: string[] = [];
  for (const re of [/`([A-Za-z0-9_][A-Za-z0-9_./-]*\.md)`/g, /\]\(([^)\s#]+\.md)\)/g]) {
    for (const m of text.matchAll(re)) out.push(m[1]);
  }
  return out.filter((t) => !t.includes("*"));
}

// A citation may be written relative to its file, relative to the repo root,
// or as a bare basename (searched across the doc homes).
const BASENAME_DIRS = [DOCS, ARCHIVE, path.join(DOCS, "v2.0"), path.join(ROOT, "src/graph/help"), ROOT];
function resolves(fromFile: string, token: string): boolean {
  const candidates = [
    path.resolve(path.dirname(fromFile), token),
    path.resolve(ROOT, token),
  ];
  if (!token.includes("/")) {
    for (const d of BASENAME_DIRS) candidates.push(path.join(d, token));
  }
  return candidates.some((c) => fs.existsSync(c));
}

describe("docs index completeness (docs/README.md)", () => {
  const index = read(path.join(DOCS, "README.md"));
  it.each(mdFiles(DOCS).filter((f) => f !== "README.md"))(
    "%s is listed in the index",
    (f) => {
      expect(index.includes(f)).toBe(true);
    },
  );
});

describe("no dead .md pointers in live docs", () => {
  it.each(scanned.map((p) => [path.relative(ROOT, p), p] as const))(
    "%s cites only existing files",
    (_rel, file) => {
      const dead = mdCitations(read(file)).filter((t) => !resolves(file, t));
      expect(dead).toEqual([]);
    },
  );
});

describe("archive completeness (docs/archive/README.md)", () => {
  const index = read(path.join(ARCHIVE, "README.md"));
  it.each(mdFiles(ARCHIVE).filter((f) => f !== "README.md"))(
    "%s is listed in the archive index",
    (f) => {
      expect(index.includes(f)).toBe(true);
    },
  );
});

describe("the routing table sends live work to LIVE docs", () => {
  // `docs/archive/` is finished, point-in-time material — CLAUDE.md tells an agent
  // exactly that, so anything routed there reads as skippable and gets skipped.
  // A doc the routing table names is by definition still load-bearing: it belongs
  // in the working set. (2026-08-11: the Formula.js divergence catalogue sat in
  // archive while routing live `excelFunctions.ts` edits at it, and a session
  // re-derived a documented failure class by hand.)
  it("routes no file into docs/archive", () => {
    const table = read(path.join(DOCS, "README.md")).split("## Code → spec routing")[1] ?? "";
    const rows = table.split("\n").filter((l) => l.startsWith("|") && l.includes("archive/"));
    expect(rows, rows.join("\n")).toEqual([]);
  });
});

describe("README routing-table code citations exist", () => {
  // Collect every code basename in the repo once; README citations are checked
  // by basename so a file move inside src/ doesn't false-fail the index.
  const basenames = new Set<string>();
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else basenames.add(e.name);
    }
  };
  walk(path.join(ROOT, "src"));
  walk(path.join(ROOT, "scripts"));
  walk(path.join(ROOT, "src-tauri", "src"));

  const readme = read(path.join(DOCS, "README.md"));
  const cited = new Set<string>();
  for (const m of readme.matchAll(/`([A-Za-z0-9_./-]+\.(?:ts|tsx|css|rs|mjs))`/g)) {
    cited.add(path.basename(m[1]));
  }
  it.each([...cited])("%s exists in the repo", (base) => {
    expect(basenames.has(base)).toBe(true);
  });
});
