import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseRulesDoc, parseArchDoc, testCitationIndex } from "./specMap";

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
