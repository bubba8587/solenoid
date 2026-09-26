// [[D87]] xyColumnMapping
import { describe, it, expect } from "vitest";
import { buildXY } from "../../../src/graph/nodes/xyPlot";
import { ChartNode, MergePlotsNode } from "../../../src/graph/nodes/visual";
import { parseChartOptions, serializeChartOptions } from "../../../src/graph/nodes/chartOptions";
import type { ChartValue, XYPayload } from "../../../src/graph/chartValue";
import { isSolError, type SolError } from "../../../src/graph/errorValue";
import type { FrameValue } from "../../../src/graph/frame";

const curve: FrameValue = { __frame: true, columns: [
  { name: "t", type: "number", values: [0, 1, 2, 3] },
  { name: "x", type: "number", values: [1, 0, null, 0] },
  { name: "y", type: "number", values: [0, 1, 0, -1] },
  { name: "mass", type: "number", values: [2, 4, 6, 8] },
  { name: "name", type: "string", values: ["a", "b", "c", "d"] },
  { name: "arm", type: "string", values: ["L", "L", "R", "R"] },
] };
const xy = (op: "scatter" | "xyline" | "bubble", frame: unknown, opts: string) => buildXY(op, frame, parseChartOptions(opts)) as XYPayload;

describe("buildXY", () => {
  it("plots named x against named y in row order, a blank cell a gap", () => {
    const p = xy("xyline", curve, "x=x;y=y");
    expect(p.series).toHaveLength(1);
    expect(p.series[0].points).toEqual([{ x: 1, y: 0 }, { x: 0, y: 1 }, null, { x: 0, y: -1 }]);
    expect(p.series[0].line).toBe("solid");
    expect(p.names).toEqual({ x: "x", y: "y" });
  });

  it("matches column names case-insensitively and trims them", () => {
    expect(xy("scatter", curve, "x= X ;y=Y").series[0].points[0]).toEqual({ x: 1, y: 0 });
  });

  it("unnamed, the first column is x and every later number column is a series", () => {
    const p = xy("scatter", curve, "");
    expect(p.names.x).toBe("t");
    expect(p.series.map((s) => s.name)).toEqual(["x", "y", "mass"]);
    expect(p.series[0].line).toBe("none");
  });

  it("a named x leaves the other number columns as the y series", () => {
    expect(xy("scatter", curve, "x=x").series.map((s) => s.name)).toEqual(["t", "y", "mass"]);
  });

  it("reads size, color and point text from their columns", () => {
    const p = xy("scatter", curve, "x=x;y=y;s=mass;c=t;annotate=name");
    expect(p.series[0].points[0]).toEqual({ x: 1, y: 0, s: 2, c: 0, text: "a" });
    expect(p.series[0].sRange).toEqual([2, 8]);
    expect(p.series[0].cRange).toEqual([0, 3]);
  });

  it("a text color column colors by category", () => {
    const p = xy("scatter", curve, "x=x;y=y;c=arm");
    expect(p.series[0].cCats).toEqual(["L", "R"]);
    expect(p.series[0].points[1]?.c).toBe("L");
  });

  it("by splits each y column into one series per group, in first-seen order", () => {
    const one = xy("xyline", curve, "x=t;y=y;by=arm");
    expect(one.series.map((s) => s.name)).toEqual(["L", "R"]);
    expect(one.series[1].points).toEqual([{ x: 2, y: 0 }, { x: 3, y: -1 }]);
    const two = xy("xyline", curve, "x=t;y=x,y;by=arm");
    expect(two.series.map((s) => s.name)).toEqual(["x · L", "x · R", "y · L", "y · R"]);
  });

  it("a text x column becomes categories, each x an index into them", () => {
    const p = xy("scatter", curve, "x=arm;y=y");
    expect(p.xcats).toEqual(["L", "R"]);
    expect(p.series[0].points.map((q) => q?.x)).toEqual([0, 0, 1, 1]);
  });

  it("a list plots at x = 1, 2, 3 and a number is one point", () => {
    expect(xy("scatter", [5, null, 7], "").series[0].points).toEqual([{ x: 1, y: 5 }, null, { x: 3, y: 7 }]);
    expect(xy("scatter", 4, "").series[0].points).toEqual([{ x: 1, y: 4 }]);
  });

  it("bubble defaults to the first three number columns as x, y and size", () => {
    const p = xy("bubble", curve, "");
    expect(p.names).toEqual({ x: "t", y: "x", s: "y" });
    expect(xy("bubble", curve, "s=mass").names).toEqual({ x: "t", y: "x", s: "mass" });
  });

  it("a named column the data lacks is #REF!, a text column in a number role #TYPE!", () => {
    const miss = buildXY("scatter", curve, parseChartOptions("x=x;y=z")) as SolError;
    expect(miss.code).toBe("#REF!");
    expect(miss.message).toContain('"z"');
    expect((buildXY("scatter", curve, parseChartOptions("x=x;y=name")) as SolError).code).toBe("#TYPE!");
    expect((buildXY("bubble", curve, parseChartOptions("s=arm")) as SolError).code).toBe("#TYPE!");
  });

  it("linestyle overrides the op's default; XY Line markers follow the series count", () => {
    expect(xy("scatter", curve, "x=x;y=y;linestyle=--").series[0].line).toBe("dashed");
    expect(xy("xyline", curve, "x=x;y=y;ls=none").series[0].line).toBe("none");
    expect(xy("xyline", curve, "x=x;y=y").series[0].marker).toBe(true);
    expect(xy("xyline", curve, "x=t;y=x,y").series[0].marker).toBe(false);
    expect(xy("xyline", curve, "x=t;y=x,y;marker=on").series[0].marker).toBe(true);
  });
});

describe("Chart node, XY ops", () => {
  it("emits the XY payload and titles the axes after named columns", () => {
    const out = new ChartNode({ op: "xyline" }).data({ values: [curve], options: ["x=x;y=y"] }).chart as ChartValue;
    expect(out.payload?.kind).toBe("xy");
    expect(out.options).toMatchObject({ xlabel: "x", ylabel: "y" });
    expect(out.values).toEqual([0, 1, null, -1]);
  });

  it("surfaces a bad column name as the chart's error", () => {
    const n = new ChartNode({ op: "scatter" });
    const out = n.data({ values: [curve], options: ["x=nope"] }).chart;
    expect(isSolError(out) && out.code).toBe("#REF!");
    expect(n.cachedError?.code).toBe("#REF!");
    n.data({ values: [curve], options: ["x=x"] });
    expect(n.cachedError).toBeNull();
  });
});

describe("Merge Plots, XY", () => {
  const sc = (opts: string, extra: Partial<ChartValue> = {}) =>
    ({ ...(new ChartNode({ op: "scatter" }).data({ values: [curve], options: [opts] }).chart as ChartValue), ...extra });

  it("overlays scatters on one numeric plane, each keeping its own x", () => {
    const n = new MergePlotsNode();
    const out = n.data({ p0: [sc("x=x;y=y;color=red")], p1: [sc("x=t;y=mass")] }).chart as ChartValue;
    expect(out.op).toBe("overlay");
    const p = out.payload as XYPayload;
    expect(p.kind).toBe("xy");
    expect(p.series.map((s) => s.points[0])).toEqual([{ x: 1, y: 0 }, { x: 0, y: 2 }]);
    expect(p.series[0].color).toBe("red");
  });

  it("takes bubbles, and a line against numbers or row positions joins as a solid line", () => {
    const bubble = new ChartNode({ op: "bubble" }).data({ values: [curve] }).chart as ChartValue;
    const line: ChartValue = { __chart: true, op: "line", values: [5, 6], labels: [10, 20], options: {}, title: "L" };
    const list: ChartValue = { __chart: true, op: "area", values: [7, 8], options: {}, title: "A" };
    const n = new MergePlotsNode();
    n.addValueInput();
    const p = (n.data({ p0: [bubble], p1: [line], p2: [list] }).chart as ChartValue).payload as XYPayload;
    expect(p.series[0].sRange).toBeDefined();
    expect(p.series[1]).toMatchObject({ name: "L", line: "solid", points: [{ x: 10, y: 5 }, { x: 20, y: 6 }] });
    expect(p.series[2].points).toEqual([{ x: 1, y: 7 }, { x: 2, y: 8 }]);
  });

  it("refuses bars and text-labelled plots beside an XY plot", () => {
    const bars: ChartValue = { __chart: true, op: "column", values: [1], options: {} };
    const months: ChartValue = { __chart: true, op: "line", values: [1, 2], labels: ["Jan", "Feb"], options: {} };
    const a = new MergePlotsNode().data({ p0: [sc("x=x;y=y")], p1: [bars] }).chart as SolError;
    expect(a.code).toBe("#TYPE!");
    expect(a.message).toContain("Plot 2");
    expect((new MergePlotsNode().data({ p0: [months], p1: [sc("x=x;y=y")] }).chart as SolError).code).toBe("#TYPE!");
  });
});

describe("XY option keys", () => {
  it("parse to their fields", () => {
    expect(parseChartOptions("x=t;y=a, b;s=m;c=k;annotate=n;by=g;ls=-.;xlim=0,;aspect=equal")).toEqual({
      x: "t", y: ["a", "b"], s: "m", c: "k", annotate: "n", by: "g", linestyle: "dashdot", xmin: 0, aspect: "equal",
    });
    expect(parseChartOptions("linestyle=wavy;aspect=tall")).toEqual({});
  });

  it("serialize from the builder, xlim as one pair", () => {
    expect(serializeChartOptions({ x: "t", y: "a,b", linestyle: "dashed", xmin: 1, xmax: null })).toBe("x=t;y=a,b;linestyle=dashed;xlim=1,");
  });
});
