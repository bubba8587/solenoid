// [[C50]] lambdaBindsByName, [[frame-verbs#pivot]]
import { describe, it, expect } from "vitest";
import { frameSourceToText, type FrameValue } from "../../../src/graph/frame";
import { FrameInputNode, PivotNode } from "../../../src/graph/nodes/frame";
import { LambdaNode } from "../../../src/graph/nodes/lambda";
import { extractInit } from "../../../src/graph/nodeInit";
import { isSolError } from "../../../src/graph/errorValue";

// A fleet's fuel log: MPG per plate per month is miles over gallons in that cell's rows.
const log = new FrameInputNode({
  frameText: frameSourceToText([
    { name: "Month", type: "string", cells: ["2026-01", "2026-01", "2026-02", "2026-01", "2026-02", "2026-02"] },
    { name: "Plate", type: "string", cells: ["ABC-123", "ABC-123", "ABC-123", "XYZ-789", "XYZ-789", "XYZ-789"] },
    { name: "Miles", type: "number", cells: ["100", "200", "200", "200", "150", "250"] },
    { name: "Gallons", type: "number", cells: ["4", "6", "10", "20", "4", "6"] },
  ]),
}).data({}).frame as FrameValue;

const lambda = (params: string, expr: string) => new LambdaNode({ params, expr }).data({}).result;

function pivot(expr: string, params: string, values = "") {
  const n = new PivotNode({ rowTotalDepth: 1, colTotalDepth: 1, valueKeys: ["calcName0", "calcFn0"] });
  Object.assign(n.stringLiterals, { rowFields: "Plate", colFields: "Month", values, calcName0: "MPG" });
  // The graph hands a card its field lists as inputs; a direct call passes them so.
  const valueList = values.split(",").map((v) => v.trim()).filter(Boolean);
  const out = n.data({ frame: [log], rowFields: [["Plate"]], colFields: [["Month"]], values: [valueList], calcFn0: [lambda(params, expr)] }).frame as FrameValue;
  return { n, out, col: (name: string) => out.columns.find((c) => c.name === name)!.values };
}

describe("PIVOTBY calculated fields", () => {
  it("each cell, totals included, is the LAMBDA over its own rows: a ratio of sums, never an average of ratios", () => {
    const { col } = pivot("SUM(Miles) / SUM(Gallons)", "Miles, Gallons");
    expect(col("Plate")).toEqual(["ABC-123", "XYZ-789", "Grand Total"]);
    expect(col("2026-01")).toEqual([30, 10, 500 / 30]);
    expect(col("2026-02")).toEqual([20, 40, 30]);
    // XYZ-789 averages its months to 25; its miles over its gallons are 20.
    expect(col("Grand Total")).toEqual([25, 20, 22]);
  });

  it("sits beside the ordinary value fields, named in the headers as a value is", () => {
    const { col } = pivot("SUM(Miles) / SUM(Gallons)", "Miles, Gallons", "Miles, Gallons");
    expect(col("2026-01 | Miles")).toEqual([300, 200, 500]);
    expect(col("2026-01 | MPG")).toEqual([30, 10, 500 / 30]);
  });

  it("a list answer is #SHAPE!, a parameter naming no column #NAME?, and @ has no row here", () => {
    const code = (expr: string, params: string) => {
      const cell = pivot(expr, params).col("Grand Total")[2];
      return isSolError(cell) ? cell.code : cell;
    };
    expect(code("Miles / Gallons", "Miles, Gallons")).toBe("#SHAPE!");
    expect(code("SUM(Mileage)", "Mileage")).toBe("#NAME?");
    expect(code("SUM(@Miles)", "Miles")).toBe("#REF!");
  });

  it("the field's row saves with the card, and the layout captions it by name", () => {
    const { n, out } = pivot("SUM(Miles) / SUM(Gallons)", "Miles, Gallons");
    expect(extractInit(n).valueKeys).toEqual(expect.arrayContaining(["calcName0", "calcFn0"]));
    expect(new PivotNode({ valueKeys: ["calcName3", "calcFn3"] }).valuePairKeys()).toEqual([["calcName3", "calcFn3"]]);
    expect(out.columns.length).toBe(4);
  });
});
