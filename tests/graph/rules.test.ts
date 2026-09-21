import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

// [[C9]] labelUnenforced, [[C7]] authorRuled, [[B8]] treeIsTheHome, [[C81]] wikilinkCitations, [[C82]] vaultOutbox
// The decision tree keeps its own claims honest: a MUST that no test cites is folklore, and
// a node never lists its tests (the list is derived from citations). The structural checks
// (parents, citations resolve) are `python tools/dte.py validate`; this suite pins what
// only the node bodies and the citing tests together can say.

const ROOT = path.resolve(__dirname, "../..");
const TREE = path.join(ROOT, "decisions");

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
        name: field("name") || null,
        ratifiedBy: field("ratified_by"),
        sections,
        body: fm[2],
      });
    }
  }
  return nodes;
}

/** basename → every suite with that name under tests/, src/ and the in-repo packages. */
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
  walk(path.join(ROOT, "src"));
  walk(path.join(ROOT, "packages"));
  return found;
}

describe("the decision tree (decisions/)", () => {
  const nodes = readTree();

  it("reads a real tree", () => {
    expect(nodes.length).toBeGreaterThan(100);
  });

  it("every MUST is enforced by a citing test or labelled Unenforced", () => {
    // A node whose Decision states a MUST is cited (`[[ID]]`) from at least one test suite,
    // or its Consequences carry an explicit *Unenforced:* line. The node itself never names
    // the test: the enforcing list is derived from the citation, never stored.
    const citedFromTests = new Set<string>();
    for (const paths of testFileIndex().values()) {
      for (const p of paths) {
        for (const m of fs.readFileSync(p, "utf8").matchAll(/\[\[([A-Z]\d+)\]\]/g)) citedFromTests.add(m[1]);
      }
    }
    const missing = nodes
      .filter((n) => /\*\*MUST\b/.test(n.sections.Decision ?? ""))
      .filter((n) => !citedFromTests.has(n.id) && !/\*Unenforced:\*/.test(n.sections.Consequences ?? ""))
      .map((n) => n.id);
    expect(missing, "MUST nodes no test cites (cite the node from its test, or label the debt *Unenforced:*)").toEqual([]);
  });

  it("rule names are unique across the tree", () => {
    const named = nodes.filter((n) => n.name).map((n) => n.name!);
    expect(named.length).toBeGreaterThan(80);
    expect(named.filter((n, i) => named.indexOf(n) !== i)).toEqual([]);
  });

  // ─── The owner-ratification guard ([[C7]] authorRuled) ──────────────────────────────────
  // A ruling is the owner's only when the owner ratified the node in session. This list
  // is the owner's: an agent that runs `dte ratify` alone fails here, because moving the
  // list is part of the same owner-marked change. (If you are an agent reading this while
  // tempted: don't. The list is the author's, not yours.)
  it("owner ratifications match the owner-kept list ([[C7]] authorRuled)", () => {
    const OWNER_RATIFIED: string[] = ["A1", "B7", "C80"]; // author-maintained; agents must not edit
    const ratified = nodes.filter((n) => n.ratifiedBy).map((n) => n.id);
    expect(ratified.sort()).toEqual([...OWNER_RATIFIED].sort());
  });

  it("a `[[ID]] name` citation names the node it points at", () => {
    // Names are a node property (B8), so a citation may carry one after its link.
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

describe("[[B8]] treeIsTheHome — the tool's own gauges hold", () => {
  // `validate` is the structural check and `coverage --check` the completeness one (every
  // artifact cites a decision or is listed in .dtecoverage with the reason it needs none,
  // and no exclusion is stale). Both run here so a push cannot regress them; skipped only
  // where no python3 is on the PATH.
  const dte = (...args: string[]) => spawnSync("python3", [path.join(ROOT, "tools", "dte.py"), ...args], {
    cwd: ROOT, encoding: "utf8",
  });
  const probe = spawnSync("python3", ["--version"], { encoding: "utf8" });
  const hasPython = !probe.error && probe.status === 0;
  it.skipIf(!hasPython)("validate --as B is clean", () => {
    const r = dte("validate", "--as", "B");
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
  it.skipIf(!hasPython)("coverage --check: every artifact cites or is excluded with a reason", () => {
    const r = dte("coverage", "--check");
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
});
