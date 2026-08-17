import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildSuiteNodes, parseRulesDoc, parseArchDoc, testCitationIndex } from "./specMap";

// The spec-map view is only as honest as this parser: a silent parse miss
// renders a map that claims fewer rules/modules than the docs hold. These pin
// the parser against the REAL docs, using the docs' own declared totals (the
// "<N> rules." line, the summary table) as the oracle — the same self-claims
// rules.test.ts already keeps honest.

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, p), "utf8");
const RULES = read("../../docs/rules.md");
const ARCH = read("../../docs/architecture.md");

describe("parseRulesDoc", () => {
  const model = parseRulesDoc(RULES);

  it("finds every rule the doc declares", () => {
    const declared = Number(RULES.match(/^(\d+) rules\./m)?.[1]);
    expect(declared).toBeGreaterThan(0);
    expect(model.ruleCount).toBe(declared);
    const headings = [...RULES.matchAll(/^### (?:PROV|SSOT|SOCK|FX|VAL|PERSIST|ENGINE|EFFECT|STORE)-\d+/gm)];
    expect(model.ruleCount).toBe(headings.length);
  });

  it("every rule carries a title, grade and MUST text", () => {
    for (const d of model.domains)
      for (const r of d.rules) {
        expect(r.title.length, r.id).toBeGreaterThan(0);
        expect(["ARR", "INFERRED", "DEFAULT"]).toContain(r.grade);
        expect(r.must.length, `${r.id} MUST text`).toBeGreaterThan(10);
      }
  });

  it("enforcement statuses partition the rules per the summary table", () => {
    const rows = [...RULES.matchAll(/^\| (Enforced|Partially enforced|Unenforced) \| (\d+) \|/gm)];
    const counts = Object.fromEntries(rows.map((m) => [m[1], Number(m[2])]));
    expect(model.summary.enforced).toBe(counts["Enforced"]);
    expect(model.summary.partial).toBe(counts["Partially enforced"]);
    expect(model.summary.unenforced).toBe(counts["Unenforced"]);
  });

  it("domains carry blurbs and PROV-1 is the one ARR rule", () => {
    expect(model.domains.length).toBeGreaterThanOrEqual(9);
    for (const d of model.domains) expect(d.blurb.length, d.prefix).toBeGreaterThan(20);
    const arr = model.domains.flatMap((d) => d.rules).filter((r) => r.grade === "ARR");
    expect(arr.map((r) => r.id)).toEqual(["PROV-1"]);
  });

  it("cited tests survive into the model (spot: SSOT-1)", () => {
    const ssot1 = model.domains.flatMap((d) => d.rules).find((r) => r.id === "SSOT-1");
    expect(ssot1?.tests).toContain("nodeOps.test.ts");
    const index = testCitationIndex(model);
    expect(index.get("nodeOps.test.ts")).toContain("SSOT-1");
    expect(index.size).toBeGreaterThan(30);
  });

  it("body sections and module citations survive into the model", () => {
    const rules = model.domains.flatMap((d) => d.rules);
    // The doc's own marker counts are the oracle: every `*Why:*` / `*Origin:*`
    // line sits in some rule body, so a shortfall here is a parse miss.
    const withWhy = rules.filter((r) => r.why.length > 0).length;
    const withOrigin = rules.filter((r) => r.origin.length > 0).length;
    expect(withWhy).toBe([...RULES.matchAll(/^\*Why:\*/gm)].length);
    expect(withOrigin).toBe([...RULES.matchAll(/^\*Origin:\*/gm)].length);
    // Exceptions text appears exactly where the boolean says it does.
    for (const r of rules) expect(r.exceptions.length > 0, r.id).toBe(r.hasExceptions);
    // Module refs never include test files (spot: SSOT-9 names dropInputCables' home).
    for (const r of rules) for (const f of r.moduleRefs) expect(f).not.toMatch(/\.test\.ts$/);
    const ssot9 = rules.find((r) => r.id === "SSOT-9");
    expect(ssot9?.moduleRefs.length).toBeGreaterThan(0);
  });
});

describe("buildSuiteNodes", () => {
  const model = parseRulesDoc(RULES);
  const groups = parseArchDoc(ARCH);
  const suites = buildSuiteNodes(model, groups);

  it("covers every cited suite exactly once, each linked to its rules' domains", () => {
    const index = testCitationIndex(model);
    expect(suites.map((s) => s.suite).sort()).toEqual([...index.keys()].sort());
    for (const s of suites) {
      expect(s.ruleIds).toEqual(index.get(s.suite));
      expect(s.domains.sort()).toEqual([...new Set(s.ruleIds.map((id) => id.split("-")[0]))].sort());
    }
  });

  it("stem-matches home groups without inventing any (spot: activeGraph, fcDockReload)", () => {
    const active = suites.find((s) => s.suite === "activeGraph.test.ts");
    expect(active?.groups).toContain("Engine / core");
    // fcDockReload has no module row of its own: untabled is the honest answer.
    const dock = suites.find((s) => s.suite === "fcDockReload.test.ts");
    expect(dock?.groups).toEqual([]);
  });

  it("orders the middle layer by neighborhood, not doc order", () => {
    // Barycenter keys must be non-decreasing under the returned order.
    const domainAt = new Map(model.domains.map((d, i) => [d.prefix, i]));
    const groupAt = new Map(groups.map((g, i) => [g.title, i]));
    const norm = (i: number, n: number) => (n <= 1 ? 0.5 : i / (n - 1));
    const key = (s: (typeof suites)[number]) => {
      const ks = [
        ...s.domains.map((d) => norm(domainAt.get(d)!, model.domains.length)),
        ...s.groups.map((g) => norm(groupAt.get(g)!, groups.length)),
      ];
      return ks.reduce((a, b) => a + b, 0) / ks.length;
    };
    for (let i = 1; i < suites.length; i++)
      expect(key(suites[i])).toBeGreaterThanOrEqual(key(suites[i - 1]));
  });
});

describe("parseArchDoc", () => {
  const groups = parseArchDoc(ARCH);

  it("finds the module tables at the doc's own scale", () => {
    // architecture.md keeps one `| module | role |` row per concern; the doc
    // holds 100+ today. A parser regression that drops a table shows up here.
    const modules = groups.flatMap((g) => g.modules);
    expect(groups.length).toBeGreaterThanOrEqual(8);
    expect(modules.length).toBeGreaterThanOrEqual(100);
    for (const m of modules) {
      expect(m.name.length).toBeGreaterThan(0);
      expect(m.role.length).toBeGreaterThan(0);
    }
  });

  it("keeps group titles readable (path parentheticals stripped)", () => {
    for (const g of groups) expect(g.title).not.toMatch(/`/);
    expect(groups.some((g) => /Engine \/ core/.test(g.title))).toBe(true);
  });
});
