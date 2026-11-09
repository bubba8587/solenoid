// [[C96]] chartOptionsAreMatplotlib, [[chart-figures#XY plots]]
import { describe, it, expect } from "vitest";
import { ChartNode, MergePlotsNode } from "../../../src/graph/nodes/visual";
import { chartOptionsOf } from "../coreVerbs";
import type { ChartValue, XYPayload } from "../../../src/graph/chartValue";
import { type SolError } from "../../../src/graph/errorValue";
import type { FrameValue } from "../../../src/graph/frame";
import { refShape } from "../../../src/graph/components/chartCore";

const curve: FrameValue = { __frame: true, columns: [
  { name: "t", type: "number", values: [0, 1, 2, 3] },
  { name: "x", type: "number", values: [1, 0, null, 0] },
  { name: "y", type: "number", values: [0, 1, 0, -1] },
  { name: "mass", type: "number", values: [2, 4, 6, 8] },
  { name: "name", type: "string", values: ["a", "b", "c", "d"] },
  { name: "arm", type: "string", values: ["L", "L", "R", "R"] },
] };
const plot = (op: "scatter" | "xyline" | "bubble", frame: unknown, opts: string) => new ChartNode({ op }).data({ values: [frame], options: [opts] }).chart;
const xy = (op: "scatter" | "xyline" | "bubble", frame: unknown, opts: string) => (plot(op, frame, opts) as ChartValue).payload as XYPayload;

describe("Chart node, XY payload", () => {
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
    const miss = plot("scatter", curve, "x=x;y=z") as SolError;
    expect(miss.code).toBe("#REF!");
    expect(miss.message).toContain('"z"');
    expect((plot("scatter", curve, "x=x;y=name") as SolError).code).toBe("#TYPE!");
    expect((plot("bubble", curve, "s=arm") as SolError).code).toBe("#TYPE!");
  });

  it("linestyle overrides the op's default; XY Line markers follow the series count", () => {
    expect(xy("scatter", curve, "x=x;y=y;linestyle=--").series[0].line).toBe("dashed");
    expect(xy("xyline", curve, "x=x;y=y;ls=none").series[0].line).toBe("none");
    expect(xy("xyline", curve, "x=x;y=y").series[0].marker).toBe(true);
    expect(xy("xyline", curve, "x=t;y=x,y").series[0].marker).toBe(false);
    expect(xy("xyline", curve, "x=t;y=x,y;marker=on").series[0].marker).toBe(true);
  });
});


describe("Merge Plots, XY", () => {


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


});

describe("XY option keys", () => {
  it("parse to their fields", () => {
    expect(chartOptionsOf("x=t;y=a, b;s=m;c=k;annotate=n;by=g;ls=-.;xlim=0,;aspect=equal")).toEqual({
      x: "t", y: ["a", "b"], s: "m", c: "k", annotate: "n", by: "g", linestyle: "dashdot", xmin: 0, aspect: "equal",
    });
    expect(chartOptionsOf("linestyle=wavy;aspect=tall")).toEqual({});
  });

});

describe("date x and References", () => {
  const dated: FrameValue = { __frame: true, columns: [
    { name: "Month", type: "date", values: [45658, 45689, 45717] },
    { name: "USD", type: "number", values: [10, 12, 11] },
  ] };

  it("plots a date column as serials and marks the axis as dates", () => {
    const p = xy("xyline", dated, "");
    expect(p.xDate).toBe(true);
    expect(p.xcats).toBeUndefined();
    expect(p.series[0].points.map((q) => q?.x)).toEqual([45658, 45689, 45717]);
  });



  it("draws a line, a point, or an area whose missing ends run to the plot's edges", () => {
    expect(refShape({ x: 1 })).toBe("vline");
    expect(refShape({ y: 1 })).toBe("hline");
    expect(refShape({ x: 1, y: 1 })).toBe("point");
    expect(refShape({ x: 1, x2: 2 })).toBe("area");
    expect(refShape({ x: 1, x2: 2, y: 3 })).toBe("area");
    expect(refShape({ x: 1, x2: 2, y: 3, y2: 4 })).toBe("area");
    expect(refShape({ y2: 4 })).toBe("area");
    expect(refShape({})).toBeNull();
  });
});
