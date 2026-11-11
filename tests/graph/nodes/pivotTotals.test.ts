// [[C127]] pivotView, [[frame-verbs#pivot]]
// A PIVOTBY card's totals are its view's: the Frame is the leaves, the totals ride on its layout, and Export totals
// hands them on as Row Totals and Column Totals.
import { describe, it, expect } from "vitest";
import { frameSourceToText, type FrameValue } from "../../../src/graph/frame";
import { FrameInputNode, PivotNode } from "../../../src/graph/nodes/frame";
import { savedNodeBody } from "../../../src/graph/savedNodeBody";
import { pivotLayoutOf, pivotViewFrame } from "../../../src/graph/pivotLayout";

const sales = new FrameInputNode({
  frameText: frameSourceToText([
    { name: "Region", type: "string", cells: ["East", "East", "East", "West", "West"] },
    { name: "Month", type: "string", cells: ["Jan", "Feb", "Feb", "Jan", "Feb"] },
    { name: "Sales", type: "number", cells: ["1", "2", "4", "8", "16"] },
  ]),
}).data({}).frame as FrameValue;

function run(exportTotals: boolean) {
  const n = new PivotNode({ rowTotalDepth: 1, colTotalDepth: 1, exportTotals });
  Object.assign(n.stringLiterals, { rowFields: "Region", colFields: "Month", values: "Sales" });
  const out = n.data({ frame: [sales], rowFields: [["Region"]], colFields: [["Month"]], values: [["Sales"]] });
  return { n, out: out as { frame: FrameValue; rowTotals?: FrameValue; colTotals?: FrameValue } };
}
const named = (f: FrameValue) => Object.fromEntries(f.columns.map((c) => [c.name, c.values]));

describe("PIVOTBY totals", () => {
  it("the Frame is the leaf rows by the leaf columns; the view puts the totals back", () => {
    const { out } = run(false);
    expect(named(out.frame)).toEqual({ Region: ["East", "West"], Feb: [6, 16], Jan: [1, 8] });
    expect(pivotLayoutOf(out.frame)?.totals?.rows).toHaveLength(1);
    expect(named(pivotViewFrame(out.frame))).toEqual({
      Region: ["East", "West", "Grand Total"], Feb: [6, 16, 22], Jan: [1, 8, 9], "Grand Total": [7, 24, 31],
    });
    expect(out.rowTotals).toBeUndefined();
  });

  it("Export totals adds Row Totals and Column Totals, and saves", () => {
    const { n, out } = run(true);
    expect(Object.keys(n.outputs)).toEqual(["frame", "rowTotals", "colTotals"]);
    expect(named(out.rowTotals!)).toEqual({ Region: ["East", "West"], "Grand Total": [7, 24] });
    expect(named(out.colTotals!)).toEqual({ Month: ["Feb", "Jan"], "Grand Total": [22, 9] });
    expect(savedNodeBody(n).init.exportTotals).toBe(true);
    const back = new PivotNode(savedNodeBody(n).init as never);
    expect(Object.keys(back.outputs)).toEqual(["frame", "rowTotals", "colTotals"]);
  });

  it("turning it off takes the two outputs away", () => {
    const { n } = run(true);
    n.setExportTotals(false);
    expect(Object.keys(n.outputs)).toEqual(["frame"]);
    expect(savedNodeBody(n).init.exportTotals).toBeFalsy();
  });
});
