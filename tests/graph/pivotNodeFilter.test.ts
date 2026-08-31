import { describe, it, expect } from "vitest";
import { PivotNode } from "../../src/graph/nodes/frame";
import { isFrameValue, type FrameValue } from "../../src/graph/frame";

// The Pivot node's field-value filter (filterExclude) compiles to the engine row
// mask: excluded value keys drop those source rows before the pivot aggregates,
// AND-combined with any wired logical mask.

const frame: FrameValue = {
  __frame: true,
  columns: [
    { name: "Region", type: "string", values: ["N", "S", "N", "S"] },
    { name: "Amount", type: "number", values: [10, 20, 30, 40] },
  ],
};
const col = (f: FrameValue, name: string) => f.columns.find((c) => c.name === name)?.values;

describe("PivotNode field-value filter", () => {
  it("excludes rows whose value key is hidden", () => {
    const node = new PivotNode({ label: "P", agg: "sum" });
    node.filterExclude = { Region: ["S"] };
    const out = node.data({ frame: [frame], rowFields: [["Region"]], colFields: [[]], values: [["Amount"]] });
    expect(isFrameValue(out.frame)).toBe(true);
    const f = out.frame as FrameValue;
    expect(col(f, "Region")).toEqual(["N"]); // S filtered out
    expect(col(f, "Amount")).toEqual([40]);  // 10 + 30
  });

  it("an empty exclude set is a no-op", () => {
    const node = new PivotNode({ label: "P", agg: "sum" });
    node.filterExclude = { Region: [] };
    const out = node.data({ frame: [frame], rowFields: [["Region"]], colFields: [[]], values: [["Amount"]] });
    expect(col(out.frame as FrameValue, "Region")).toEqual(["N", "S"]);
  });

  it("ANDs with a wired logical mask", () => {
    const node = new PivotNode({ label: "P", agg: "sum" });
    node.filterExclude = { Region: ["S"] };
    // wired mask keeps rows 0,1 only; the field filter then also drops S (row 1).
    const out = node.data({ frame: [frame], rowFields: [["Region"]], colFields: [[]], values: [["Amount"]], filter: [[true, true, false, false]] });
    const f = out.frame as FrameValue;
    expect(col(f, "Region")).toEqual(["N"]);
    expect(col(f, "Amount")).toEqual([10]); // only row 0 survives both
  });

  it("stashes distinct value keys for the editor's checklist", () => {
    const node = new PivotNode({ label: "P", agg: "sum" });
    node.data({ frame: [frame], rowFields: [["Region"]], colFields: [[]], values: [["Amount"]] });
    const region = node.sourceColumns.find((c) => c.name === "Region");
    expect(region?.distinct).toEqual(["N", "S"]);
  });
});

// Repointing a Pivot at a different source (e.g. the built-in frame → a CSV with
// different columns) must flush every field reference the new frame no longer has,
// or a stale name aggregates a missing column / lingers in the editor.
describe("PivotNode flushes stale fields on frame change", () => {
  // New source: Region survives, Amount is gone (replaced by qty).
  const swapped: FrameValue = {
    __frame: true,
    columns: [
      { name: "Region", type: "string", values: ["N", "S"] },
      { name: "qty", type: "number", values: [1, 2] },
    ],
  };

  it("drops fields, per-value funcs, and filters for columns the new frame lacks", () => {
    const node = new PivotNode({ label: "P", agg: "sum" });
    node.stringLiterals.rowFields = "Region"; // still valid
    node.stringLiterals.values = "Amount";    // stale after the swap
    node.funcs = { Amount: "avg" };           // stale
    node.filterExclude = { Region: ["S"], Amount: ["10"] }; // Amount stale, Region ok
    node.data({ frame: [swapped], rowFields: [["Region"]], colFields: [[]], values: [["Amount"]] });
    expect(node.stringLiterals.values).toBe("");          // "Amount" pruned
    expect(node.stringLiterals.rowFields).toBe("Region"); // kept
    expect(node.funcs).toEqual({});                       // Amount func dropped
    expect(node.filterExclude).toEqual({ Region: ["S"] }); // Amount filter dropped, Region kept
  });

  it("leaves a still-valid field untouched", () => {
    const node = new PivotNode({ label: "P", agg: "sum" });
    node.stringLiterals.values = "qty";
    node.data({ frame: [swapped], rowFields: [["Region"]], colFields: [[]], values: [["qty"]] });
    expect(node.stringLiterals.values).toBe("qty");
  });
});
