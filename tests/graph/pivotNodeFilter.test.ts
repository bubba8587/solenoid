// [[B17]], [[C48]], [[C24]] arraySemantics
import { csvList } from "../../src/graph/nodes/frameShapeHook";
import { listLiteralText } from "../../src/graph/listLiterals";
import { describe, it, expect } from "vitest";
import { PivotNode } from "../../src/graph/nodes/frame";
import type { FrameValue } from "../../src/graph/frame";

// The Pivot node's field-value filter (filterExclude) compiles to the engine row
// mask: excluded value keys drop those source rows before the pivot aggregates,
// AND-combined with any wired logical mask.



// Repointing a Pivot at a different source (e.g. the built-in frame → a CSV with
// different columns) must flush every field reference the new frame no longer has,
// or a stale name aggregates a missing column / lingers in the editor.

// A field list is a list literal: a name holding a comma or a quote survives being written and read back,
// and the stale-field flush rewrites it in the same form.
describe("PivotNode field lists keep names with commas and quotes", () => {
  const tricky: FrameValue = {
    __frame: true,
    columns: [
      { name: "Sales, 2025", type: "string", values: ["a", "b", "a"] },
      { name: 'Rep "Lead"', type: "string", values: ["x", "x", "y"] },
      { name: "Amount", type: "number", values: [1, 2, 3] },
    ],
  };
  it("round-trips through the literal and pivots on them", () => {
    const rows = ["Sales, 2025", 'Rep "Lead"'];
    expect(csvList(listLiteralText(rows))).toEqual(rows);
    expect(csvList("Region, Rep")).toEqual(["Region", "Rep"]);
    const node = new PivotNode({ label: "P", agg: "sum" });
    node.stringLiterals.rowFields = listLiteralText([...rows, "Gone"]);
    node.stringLiterals.values = "Amount";
    node.data({ frame: [tricky], rowFields: [rows], colFields: [[]], values: [["Amount"]] });
    // A field the input lacks stays saved, to count again once its column is back.
    expect(csvList(node.stringLiterals.rowFields)).toEqual([...rows, "Gone"]);
  });
});
