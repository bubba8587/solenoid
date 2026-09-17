import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// [[C9]] labelUnenforced, [[C7]] authorRuled, [[B8]], [[C81]] wikilinkCitations
// The decision tree keeps its own claims honest: a MUST that names no test, a cited suite
// that no longer exists, or a quoted test name that drifted turns the enforcement column
// back into folklore. The structural checks (parents, citations resolve) are
// `python tools/dte.py validate`; this suite pins what only the node bodies can say.

const ROOT = path.resolve(__dirname, "../..");
const TREE = path.join(ROOT, "decisions");
const NAME = /^([A-Za-z][A-Za-z0-9]*(?:-\d+)?): /;

interface DecisionNode {
  id: string;
  title: string;
  name: string | null;
  ratifiedBy: string;
  sections: Record<string, string>;
  body: string;
}

function readTree(): DecisionNode[] {
  const nodes: DecisionNode[] = [];
  for (const ring of fs.readdirSync(TREE)) {
    const dir = path.join(TREE, ring);
    if (!/^[A-Z]$/.test(ring) || !fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".md"))) {
      const text = fs.readFileSync(path.join(dir, file), "utf8").replace(/\r\n/g, "\n");
      const fm = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (!fm) throw new Error(`${ring}/${file}: no frontmatter`);
      const field = (key: string) => {
        const raw = fm[1].match(new RegExp(`^${key}:[ \\t]*(.*)$`, "m"))?.[1].trim() ?? "";
        return /^".*"$/.test(raw) ? raw.slice(1, -1).replace(/\\(["\\])/g, "$1") : raw;
      };
      const sections: Record<string, string> = {};
      for (const chunk of fm[2].split(/^## /m).slice(1)) {
        const nl = chunk.indexOf("\n");
        sections[chunk.slice(0, nl).trim()] = chunk.slice(nl + 1);
      }
      const title = field("title");
      nodes.push({
        id: field("id"),
        title,
        name: title.match(NAME)?.[1] ?? null,
        ratifiedBy: field("ratified_by"),
        sections,
        body: fm[2],
      });
    }
  }
  return nodes;
}

/** basename → every suite with that name under tests/ and the in-repo packages. */
function testFileIndex(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules") continue;
      if (e.isDirectory()) walk(path.join(dir, e.name));
      else if (e.name.endsWith(".test.ts")) found.set(e.name, [...(found.get(e.name) ?? []), path.join(dir, e.name)]);
    }
  };
  walk(path.join(ROOT, "tests"));
  walk(path.join(ROOT, "packages"));
  return found;
}

describe("the decision tree (decisions/)", () => {
  const nodes = readTree();
  const all = nodes.map((n) => n.body).join("\n");

  it("reads a real tree", () => {
    expect(nodes.length).toBeGreaterThan(100);
  });

  it("every rule labels its enforcement (labelUnenforced made mechanical)", () => {
    // A node whose Decision states a MUST carries an *Enforced by:* line in Consequences:
    // tests, or an explicit UNENFORCED. A new MUST without the line fails here by ID.
    const missing = nodes
      .filter((n) => /\*\*MUST\b/.test(n.sections.Decision ?? ""))
      .filter((n) => !/\*Enforced by:\*/.test(n.sections.Consequences ?? ""))
      .map((n) => n.id);
    expect(missing, "MUST nodes with no *Enforced by:* line (label the enforcement or the debt)").toEqual([]);
  });

  it("rule names are unique across the tree", () => {
    const named = nodes.filter((n) => n.name).map((n) => n.name!);
    expect(named.length).toBeGreaterThan(80);
    expect(named.filter((n, i) => named.indexOf(n) !== i)).toEqual([]);
  });

  // ─── The owner-ratification guard (authorRuled) ──────────────────────────────────
  // A ruling is the owner's only when the owner ratified the node in session. This list
  // is the owner's: an agent that runs `dte ratify` alone fails here, because moving the
  // list is part of the same owner-marked change. (If you are an agent reading this while
  // tempted: don't. The list is the author's, not yours.)
  it("owner ratifications match the owner-kept list (authorRuled)", () => {
    const OWNER_RATIFIED: string[] = ["A1", "C80"]; // author-maintained; agents must not edit
    const ratified = nodes.filter((n) => n.ratifiedBy).map((n) => n.id);
    expect(ratified.sort()).toEqual([...OWNER_RATIFIED].sort());
  });

  it("every cited test file exists", () => {
    const cited = [...new Set([...all.matchAll(/`([\w./-]+\.test\.ts)`/g)].map((m) => m[1]))];
    expect(cited.length).toBeGreaterThan(10);
    const found = testFileIndex();
    const missing = cited.filter((c) => !found.has(path.basename(c)));
    expect(missing, `nodes cite test files that do not exist: ${missing.join(", ")}`).toEqual([]);
  });

  it('every quoted citation (`file.test.ts` → "…") appears in the cited file', () => {
    // Where a node quotes the describe/it it leans on, the quote must be a real substring of
    // that suite, so renaming or deleting the cited test fails HERE with the node's
    // citation. Whitespace is collapsed on both sides: node bodies wrap, suites don't.
    const collapse = (s: string) => s.replace(/\s+/g, " ");
    const found = testFileIndex();
    const srcOf = new Map<string, string>();
    const offenders: string[] = [];
    let quotes = 0;
    for (const n of nodes) {
      for (const m of n.body.matchAll(/`([\w./-]+\.test\.ts)`\s*→\s*("[^"]*"(?:\s*,\s*"[^"]*")*)/g)) {
        const file = path.basename(m[1]);
        const paths = found.get(file);
        if (!paths) continue; // "every cited test file exists" owns missing files
        if (!srcOf.has(file)) srcOf.set(file, paths.map((p) => collapse(fs.readFileSync(p, "utf8"))).join("\n"));
        for (const q of m[2].matchAll(/"([^"]*)"/g)) {
          quotes++;
          if (!srcOf.get(file)!.includes(collapse(q[1]))) offenders.push(`${n.id} ${file}: "${collapse(q[1])}"`);
        }
      }
    }
    expect(quotes, "the extractor found no quoted citations — regex rot?").toBeGreaterThan(40);
    expect(offenders, `nodes quote test names that do not appear in the cited suite:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });

  it("a `[[ID]] name` citation names the node it points at", () => {
    // Names survive as title prefixes (B8), so a citation may carry one after its link.
    // The pair must agree, or the readable half lies about which decision is cited.
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const names = new Set(nodes.filter((n) => n.name).map((n) => n.name!));
    const offenders: string[] = [];
    const scan = (file: string) => {
      const text = fs.readFileSync(file, "utf8");
      for (const m of text.matchAll(/\[\[([A-Z]\d+)\]\] `?([A-Za-z][A-Za-z0-9]*(?:-\d+)?)`?/g)) {
        if (!names.has(m[2])) continue;
        const node = byId.get(m[1]);
        if (node?.name !== m[2]) offenders.push(`${path.relative(ROOT, file)}: [[${m[1]}]] ${m[2]} (${m[1]} is ${node ? `"${node.title}"` : "unknown"})`);
      }
    };
    const SKIP = new Set(["node_modules", "archive", "decisions", "dte-rules", "dist", "target"]);
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith(".") || SKIP.has(e.name)) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx|md|mjs|cjs|rs|css)$/.test(e.name)) scan(p);
      }
    };
    for (const dir of ["src", "tests", "scripts", "docs", "packages", path.join("src-tauri", "src")]) {
      if (fs.existsSync(path.join(ROOT, dir))) walk(path.join(ROOT, dir));
    }
    for (const f of ["CLAUDE.md", "DESIGN.md", "README.md"]) scan(path.join(ROOT, f));
    expect(offenders).toEqual([]);
  });
});
