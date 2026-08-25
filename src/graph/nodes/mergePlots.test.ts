import { describe, it, expect } from "vitest";
import { MergePlotsNode, PLANAR_CHART_OPS } from "./visual";
import type { ChartValue, ChartValueOp, OverlayPayload } from "../chartValue";
import { isSolError, type SolError } from "../errorValue";
import { extractInit } from "../copyPaste";

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
  it("starts with two plot rows plus an Options input", () => {
    const n = new MergePlotsNode();
    expect(n.plotKeys()).toEqual(["p0", "p1"]);
    expect(n.inputs.options).toBeTruthy();
    expect(n.outputs.chart).toBeTruthy();
  });

  it("overlays each input's series, one per source, preserving its mark kind", () => {
    const n = new MergePlotsNode();
    const res = n.data({
      p0: [chart("line", [1, 2, 3], { title: "A" })],
      p1: [chart("column", [4, 5, 6], { title: "B" })],
    });
    const p = payloadOf(res);
    expect(p.series).toMatchObject([
      { name: "A", kind: "line", values: [1, 2, 3] },
      { name: "B", kind: "column", values: [4, 5, 6] },
    ]);
  });

  it("inherits color / marker size / line width / alpha / marker from the source options", () => {
    const n = new MergePlotsNode();
    const res = n.data({
      p0: [chart("scatter", [1, 2], { options: { color: "#f00", markersize: 5, linewidth: 3, alpha: 0.5, marker: true } })],
    });
    expect(payloadOf(res).series[0]).toMatchObject({
      kind: "scatter", color: "#f00", markersize: 5, linewidth: 3, alpha: 0.5, marker: true,
    });
  });

  it("expands a multi-series source into one overlay series per column and takes its labels", () => {
    const n = new MergePlotsNode();
    const multi = chart("area", [1, 2], {
      series: [{ name: "X", values: [1, 2] }, { name: "Y", values: [3, 4] }],
      labels: ["Jan", "Feb"],
    });
    const p = payloadOf(n.data({ p0: [multi] }));
    expect(p.series).toMatchObject([
      { name: "X", kind: "area", values: [1, 2] },
      { name: "Y", kind: "area", values: [3, 4] },
    ]);
    expect(p.labels).toEqual(["Jan", "Feb"]);
  });

  it("takes labels from the FIRST labelled source only", () => {
    const n = new MergePlotsNode();
    const p = payloadOf(n.data({
      p0: [chart("line", [1, 2], { labels: ["a", "b"] })],
      p1: [chart("line", [3, 4], { labels: ["x", "y"] })],
    }));
    expect(p.labels).toEqual(["a", "b"]);
  });

  it("wraps a single scalar value into a one-point series", () => {
    const n = new MergePlotsNode();
    const p = payloadOf(n.data({ p0: [chart("scatter", 5, { title: "S" })] }));
    expect(p.series).toMatchObject([{ name: "S", kind: "scatter", values: [5] }]);
  });

  it("skips empty and blank rows", () => {
    const n = new MergePlotsNode();
    const p = payloadOf(n.data({ p0: [null], p1: [chart("line", [1], { title: "B" })] }));
    expect(p.series).toMatchObject([{ name: "B", kind: "line", values: [1] }]);
  });

  it("refuses a non-plot figure with a #TYPE! naming the input", () => {
    const n = new MergePlotsNode();
    const res = n.data({ p0: [chart("line", [1, 2])], p1: [chart("pie", [1, 2])] });
    expect(isSolError(res.chart)).toBe(true);
    const err = res.chart as SolError;
    expect(err.code).toBe("#TYPE!");
    expect(err.message).toContain("Plot 2");
    expect(err.message).toContain("pie");
  });

  it("refuses composed and bubble too — only the five x/y kinds overlay", () => {
    expect([...PLANAR_CHART_OPS].sort()).toEqual(["area", "bar", "column", "line", "scatter"]);
    const n = new MergePlotsNode();
    expect(isSolError(n.data({ p0: [chart("composed", [1])] }).chart)).toBe(true);
    expect(isSolError(n.data({ p0: [chart("bubble", [1])] }).chart)).toBe(true);
    expect(isSolError(n.data({ p0: [chart("kpi", null)] }).chart)).toBe(true);
  });

  it("clears a prior refusal once every input is a plot again", () => {
    const n = new MergePlotsNode();
    expect(isSolError(n.data({ p0: [chart("pie", [1])] }).chart)).toBe(true);
    // Re-run with only plots: the stale error must not linger.
    const res = n.data({ p0: [chart("line", [1, 2])] });
    expect(isSolError(res.chart)).toBe(false);
    expect((res.chart as ChartValue).op).toBe("overlay");
  });

  it("parses the Options socket and titles the figure", () => {
    const n = new MergePlotsNode();
    const res = n.data({ p0: [chart("line", [1, 2])], options: ["title=Merged;grid=off"] });
    expect(n.chartOptions).toMatchObject({ title: "Merged", grid: false });
    expect((res.chart as ChartValue).title).toBe("Merged");
  });

  it("titles from the node label when Options gives none", () => {
    const n = new MergePlotsNode({ label: "Overlaid" });
    const res = n.data({ p0: [chart("line", [1, 2])] });
    expect((res.chart as ChartValue).title).toBe("Overlaid");
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
