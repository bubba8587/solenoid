import { describe, it, expect } from "vitest";
import { buildFunctionReference, libraryTags, LIBRARY_TAGS } from "./functionReference";

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
