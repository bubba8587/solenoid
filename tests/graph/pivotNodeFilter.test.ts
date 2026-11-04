// [[B17]] typedValueModel, [[C48]] appendLadder, [[C24]] arraySemantics, [[frame-verbs#pivot]]
import { csvList } from "../../src/graph/nodes/frameShapeHook";
import { listLiteralText } from "../../src/graph/listLiterals";
import { describe, it, expect } from "vitest";
import { PivotNode } from "../../src/graph/nodes/frame";
import type { FrameValue } from "../../src/graph/frame";

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
    expect(csvList(node.stringLiterals.rowFields)).toEqual([...rows, "Gone"]);
  });
});
