import { describe, it, expect } from "vitest";
import { buildFunctionReference, libraryTags, LIBRARY_TAGS } from "../../src/graph/functionReference";
import { EXCEL_GAP } from "../../src/graph/nodeExcel";
import { ELIMINATED_FUNCTIONS } from "../../src/graph/excelFunctions";

// The gap list's two-way partition drives the Reference's Superseded / Out of scope
// sections; "superseded" additionally promises the formula surface blocks the name
// and names the replacement.
describe("gap-row scope (Superseded / Out of scope)", () => {
  it("every gap row carries exactly one scope", () => {
    for (const g of EXCEL_GAP) {
      const n = (g.superseded ? 1 : 0) + (g.oos ? 1 : 0);
      expect(n, g.excel).toBe(1);
    }
  });
  it("every superseded row is blocked on the formula surface (LEGACY_ALIASES)", () => {
    for (const g of EXCEL_GAP) {
      if (g.superseded) expect(ELIMINATED_FUNCTIONS.has(g.excel), g.excel).toBe(true);
    }
  });
  it("there is no to-do tier: every unimplemented Excel row has a scope", () => {
    for (const r of buildFunctionReference()) {
      if (r.excel !== null && !r.implemented) {
        expect(r.superseded || r.oos, r.excel).toBe(true);
      }
    }
  });
});

// The Reference overlay's library chips derive from the catalog prose + keywords; this
// pins the detector on real rows so a description rewrite can't silently untag a family.
describe("Reference overlay library tags (numpy / pandas / scipy / R / SQL / Excel)", () => {
  const rows = buildFunctionReference();
  const byLabel = (label: string) => rows.find((r) => r.nodeLabel === label)!;

  it("tags the obvious citations", () => {
    expect(libraryTags(byLabel("DIFF"))).toEqual(expect.arrayContaining(["numpy", "pandas"]));
    expect(libraryTags(byLabel("Window"))).toEqual(expect.arrayContaining(["pandas", "R", "SQL"]));
    expect(libraryTags(byLabel("Outliers"))).toEqual(expect.arrayContaining(["scipy", "R"]));
    expect(libraryTags(byLabel("Truncate Date"))).toEqual(expect.arrayContaining(["pandas", "R", "SQL"]));
    expect(libraryTags(byLabel("Describe"))).toEqual(expect.arrayContaining(["pandas", "R"]));
    expect(libraryTags(byLabel("SUM"))).toContain("Excel");
  });
  it("does not tag R from an unrelated capital R (R², RSQ, 'Rows')", () => {
    expect(libraryTags({ excel: null, description: "R², the square of the correlation. Rows are options.", keywords: "" })).not.toContain("R");
    expect(libraryTags({ excel: null, description: "Spearman ρ. scipy spearmanr, R cor(method=\"spearman\").", keywords: "" })).toContain("R");
  });
  it("every library chip has at least a handful of rows behind it", () => {
    for (const lib of LIBRARY_TAGS) {
      const n = rows.filter((r) => libraryTags(r).includes(lib)).length;
      expect(n, lib).toBeGreaterThanOrEqual(lib === "SQL" ? 3 : 5);
    }
  });
});
