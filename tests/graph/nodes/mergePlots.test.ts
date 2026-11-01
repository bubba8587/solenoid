// [[B11]], [[C100]] chartIsAValue
import { describe, it, expect } from "vitest";
import { MergePlotsNode } from "../../../src/graph/nodes/visual";
import type { ChartValue, ChartValueOp, OverlayPayload } from "../../../src/graph/chartValue";
import { type SolError } from "../../../src/graph/errorValue";
import { extractInit } from "../../../src/graph/nodeInit";

// A minimal single-series chart value, as one would arrive on a `chart` cable.
function chart(op: ChartValueOp, values: number | number[] | null, extra: Partial<ChartValue> = {}): ChartValue {
  return { __chart: true, op, values, options: {}, title: "Src", ...extra };
}
function payloadOf(res: { chart: ChartValue | SolError }): OverlayPayload {
  const cv = res.chart as ChartValue;
  expect(cv.__chart).toBe(true);
  expect(cv.op).toBe("overlay");
  return cv.payload as OverlayPayload;
}

describe("Merge Plots node", () => {
  it("starts with an Options input", () => {
    const n = new MergePlotsNode();
    expect(n.inputs.options).toBeTruthy();
    expect(n.outputs.chart).toBeTruthy();
  });







  it("keeps a repeated label in one source as its own slot, and an unlabelled series by position", () => {
    const n = new MergePlotsNode();
    n.addValueInput();
    const p = payloadOf(n.data({
      p0: [chart("line", [1, 2, 3], { labels: ["a", "a", "b"] })],
      p1: [chart("line", [7, 8], { labels: ["b", "a"] })],
      p2: [chart("line", [5, 6])],
    }));
    expect(p.labels).toEqual(["a", "a", "b"]);
    expect(p.series.map((s) => s.values)).toEqual([[1, 2, 3], [8, null, 7], [5, 6]]);
  });








  it("adds and removes plot rows, keeping keys unique across removals", () => {
    const n = new MergePlotsNode();
    const k = n.addValueInput();
    expect(k).toBe("p2");
    expect(n.plotKeys()).toEqual(["p0", "p1", "p2"]);
    n.removeValueInput("p1");
    expect(n.plotKeys()).toEqual(["p0", "p2"]);
    // The next key never reuses a live number.
    expect(n.addValueInput()).toBe("p3");
  });

  it("round-trips its plot rows through extractInit (valueKeys includes options; the ctor filters)", () => {
    const a = new MergePlotsNode();
    a.addValueInput(); // p0, p1, p2
    const init = extractInit(a);
    expect(init.valueKeys).toContain("options");
    const b = new MergePlotsNode(init as { valueKeys?: string[] });
    expect(b.plotKeys()).toEqual(["p0", "p1", "p2"]);
    expect(b.inputs.options).toBeTruthy();
  });
});
