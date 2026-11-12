// [[B19]] spreadsheetHabits, [[frame-verbs#pivot]], [[engineering#Table work grows with the rows, never with rows squared, and drawing stops at the screen]]
// The Pivot editor's filter list: a filtering field lists all its values, sorted, up to Excel's 10,000, and says how
// many there are; hidden values compile to the row mask however many are hidden.
import { describe, it, expect } from "vitest";
import { PivotNode } from "../../../src/graph/nodes/frame";
import type { FrameValue } from "../../../src/graph/frame";

const sources = (p: PivotNode, name: string) => p.sourceColumns.find((c) => c.name === name)!;

describe("a pivot field's filter values", () => {
  it("a filtering field lists every value sorted, numbers by value, text by character code, the blank last", () => {
    const f: FrameValue = { __frame: true, columns: [
      { name: "City", type: "string", values: ["b", null, "a", "C", "a"] },
      { name: "N", type: "number", values: [10, 9, 100, null, 9] },
    ] };
    const p = new PivotNode({ filterExclude: { City: [], N: [] } });
    p.data({ frame: [f], rowFields: [["City"]], colFields: [[]], values: [["N"]] });
    expect(sources(p, "City").distinct).toEqual(["C", "a", "b", ""]);
    expect(sources(p, "N").distinct).toEqual(["9", "10", "100", ""]);
    expect(sources(p, "N").distinctTotal).toBe(4);
  });

  it("caps at 10,000 and counts them all; hiding thousands still filters every row", () => {
    const n = 12_000;
    const f: FrameValue = { __frame: true, columns: [
      { name: "Id", type: "number", values: Array.from({ length: n }, (_, i) => n - i) },
      { name: "X", type: "number", values: Array.from({ length: n }, () => 1) },
    ] };
    const hide = Array.from({ length: 5000 }, (_, i) => String(i + 1));
    const p = new PivotNode({ filterExclude: { Id: hide } });
    const out = p.data({ frame: [f], rowFields: [[]], colFields: [[]], values: [["X"]] }).frame as FrameValue;
    const id = sources(p, "Id");
    expect(id.distinct.length).toBe(10_000);
    expect(id.distinct[0]).toBe("1");
    expect(id.distinctTotal).toBe(n);
    expect(out.columns.find((c) => c.name === "X")!.values).toEqual([n - 5000]);
  });
});
