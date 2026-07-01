import { describe, it, expect } from "vitest";
import { flattenLeaves, searchLeaves } from "./catalogSearch";
import { buildCatalog } from "./catalogUtils";

// Search against the REAL catalog tree (active entries only, as the menu does).
const leaves = flattenLeaves(buildCatalog(true));
const search = (q: string) => searchLeaves(leaves, q);
const types = (q: string, n = 5) => search(q).slice(0, n).map((l) => l.type);

describe("Add-menu search — category + type + keywords are searchable", () => {
  it("'arithmetic' surfaces the Arithmetic-category leaves (was: nothing)", () => {
    const r = search("arithmetic");
    expect(r.length).toBeGreaterThan(0);
    // The Add/Subtract/Multiply/Divide leaves all live under the Arithmetic
    // category; at least the core four should appear.
    const arithTypes = r.map((l) => l.type).filter((t) => t.startsWith("arith-"));
    expect(arithTypes).toEqual(expect.arrayContaining(["arith-add", "arith-mul", "arith-div"]));
  });

  it("'table input' ranks the Table input node #1", () => {
    // Labelled "Table" under the "Input" category → label+category = "Table Input".
    expect(types("table input")[0]).toBe("table-input");
  });

  it("'text input' and 'frame input' find their input nodes", () => {
    expect(types("text input")).toContain("text-input");
    expect(types("frame input")).toContain("frame-input");
  });

  it("an exact label still wins (no regression from the wider haystack)", () => {
    expect(types("multiply")[0]).toBe("arith-mul");
    expect(types("convert")[0]).toBe("convert");
  });

  it("Excel function names still match", () => {
    // SUMPRODUCT is an Excel name carried via the catalog→excel map.
    expect(search("sumproduct").length).toBeGreaterThan(0);
  });
});
