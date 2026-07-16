import { describe, it, expect } from "vitest";
import {
  SparklineNode, ChartNode, MermaidNode, GaugeNode, HeatmapCellNode, ChartBuilderNode, SurfaceNode, parseBorderedGrid, histogramBins,
  ContourNode, WaterfallNode, CandlestickNode, BoxplotNode, CalendarHeatmapNode, WaffleNode, QuiverNode,
  SevenSegNode, sevenSegText, boxplotStats, quantileSorted,
} from "./visual";
import type { BoxplotPayload, CandlePayload, ContourPayload, WaterfallPayload, CalHeatPayload, WafflePayload, QuiverPayload } from "../chartValue";
import type { FrameValue, FrameColumn } from "../frame";
import { DatePickerNode, XYPadNode } from "./control";
import { extractInit } from "../copyPaste";
import { jsDateToSerial } from "./date";
import { isMermaidValue } from "../mermaidValue";

describe("visual nodes", () => {
  it("Sparkline emits a chart value; Chart emits a first-class chart value", () => {
    const sp = new SparklineNode({ op: "column" });
    expect(sp.op).toBe("column");
    expect(sp.data({ values: [[1, 2, 3]] }).chart).toMatchObject({ __chart: true, op: "column", values: [1, 2, 3] });
    expect(sp.data({}).chart).toMatchObject({ __chart: true, values: [] });
    // legacy "bar" migrates to "column"; retired "area" → "line"
    expect(new SparklineNode({ op: "bar" as "column" }).op).toBe("column");
    expect(new SparklineNode({ op: "area" as "line" }).op).toBe("line");
    // win/loss renders as a column chart of the signs (+1 / −1 / 0)
    expect(new SparklineNode({ op: "winloss" }).data({ values: [[3, -2, 0, 5]] }).chart)
      .toMatchObject({ op: "column", values: [1, -1, 0, 1] });

    // A Chart is a terminal figure — its output is the `chart` object value
    // (op + values + options), the thing a Report renders inline, NOT a
    // numlist pass-through (nothing consumed that; a chart is a sink).
    const ch = new ChartNode({ op: "line" });
    expect(ch.data({ values: [[4, 5]] })).toEqual({
      // `matrix` is null for the 1-D ops (it carries the composed/bubble 2-D feed).
      chart: { __chart: true, op: "line", values: [4, 5], matrix: null, options: {}, title: "Chart" },
    });
  });

  it("Chart parses its Options socket into chartOptions", () => {
    const ch = new ChartNode();
    ch.data({ values: [[1, 2]], options: ["title=Hi;color=red;grid=off;ylim=0,9"] });
    expect(ch.chartOptions).toEqual({ title: "Hi", color: "red", grid: false, ymin: 0, ymax: 9 });
    // no options wired → empty (Sparkline-equivalent look)
    ch.data({ values: [[1, 2]] });
    expect(ch.chartOptions).toEqual({});
  });

  it("Mermaid emits a first-class diagram value from its source", () => {
    const m = new MermaidNode({ label: "Flow" });
    // Inline source is stored in stringLiterals (round-trips like Chart's options).
    m.stringLiterals.source = "graph TD; A-->B";
    const out = m.data({});
    expect(isMermaidValue(out.diagram)).toBe(true);
    expect(out.diagram).toEqual({ __mermaid: true, source: "graph TD; A-->B", title: "Flow" });
    // A wired source socket overrides the inline text.
    const wired = m.data({ source: ["sequenceDiagram; A->>B: hi"] });
    expect(wired.diagram.source).toBe("sequenceDiagram; A->>B: hi");
    expect(m.cachedSource).toBe("sequenceDiagram; A->>B: hi");
  });

  it("Gauge passes the single value through (read as a percentage by the view)", () => {
    const g = new GaugeNode();
    expect(g.data({ value: [1.5] })).toEqual({ result: 1.5 });
    // unwired value → literal fallback (0)
    expect(g.data({})).toEqual({ result: 0 });
  });

  it("Heatmap passes a Table straight through", () => {
    const h = new HeatmapCellNode();
    expect(h.data({ table: [[[1, 2], [3, 4]]] })).toEqual({ result: [[1, 2], [3, 4]] });
    expect(h.data({})).toEqual({ result: null });
  });

  it("op + literals round-trip through extractInit", () => {
    const sp = new SparklineNode({ op: "column" });
    const sp2 = new SparklineNode(extractInit(sp));
    expect(sp2.op).toBe("column");

    const g = new GaugeNode();
    g.literals.min = 10;
    g.literals.max = 20;
    const init = extractInit(g);
    expect(init.min).toBe(10);
    expect(init.max).toBe(20);
  });
});

describe("Surface (3-D plot)", () => {
  it("parses a bordered table into axes + heights (corner ignored, non-numeric → blank)", () => {
    //   ·   0   10        row 0 = X coords
    //   0   1   2         col 0 = Y coords, interior = Z
    //   5   3   x         a non-numeric cell → null
    const { xs, ys, z } = parseBorderedGrid([
      [null, 0, 10],
      [0, 1, 2],
      [5, 3, "x" as unknown as number],
    ]);
    expect(xs).toEqual([0, 10]);
    expect(ys).toEqual([0, 5]);
    expect(z).toEqual([[1, 2], [3, null]]);
  });

  it("returns empty axes for a too-small table", () => {
    expect(parseBorderedGrid([[null, 0]])).toEqual({ xs: [], ys: [], z: [] });
    expect(parseBorderedGrid(null)).toEqual({ xs: [], ys: [], z: [] });
  });

  it("emits a surface ChartValue carrying the parsed grid + default view angles", () => {
    const s = new SurfaceNode({ label: "Heights" });
    const out = s.data({ grid: [[[null, 0, 10], [0, 1, 2], [5, 3, 4]]] });
    expect(out.chart).toMatchObject({
      __chart: true,
      op: "surface",
      title: "Heights",
      payload: { kind: "surface", xs: [0, 10], ys: [0, 5], z: [[1, 2], [3, 4]], yaw: 45, pitch: 45 },
    });
    // Unwired → empty grid, still a valid (drawable-as-empty) surface value.
    expect(new SurfaceNode().data({}).chart).toMatchObject({ op: "surface", payload: { kind: "surface", xs: [], ys: [], z: [] } });
  });

  it("the view angles round-trip through extractInit (rotate buttons persist)", () => {
    const s = new SurfaceNode();
    s.literals.yaw = 135;
    s.literals.pitch = 60;
    const s2 = new SurfaceNode(extractInit(s));
    expect(s2.literals.yaw).toBe(135);
    expect(s2.literals.pitch).toBe(60);
    expect(s2.data({}).chart.payload).toMatchObject({ yaw: 135, pitch: 60 });
  });
});

describe("Chart Builder", () => {
  it("joins inline fields into the options string, omitting empties", () => {
    const b = new ChartBuilderNode();
    b.stringLiterals.title = "Sales";
    b.stringLiterals.color = "#56b4e9";
    b.stringLiterals.grid = "on";
    b.literals.ymin = 0;
    b.literals.ymax = 100;
    b.literals.linewidth = 2;
    expect(b.data({})).toEqual({ result: "title=Sales;color=#56b4e9;grid=on;ylim=0,100;linewidth=2" });
    expect(b.cachedString).toBe("title=Sales;color=#56b4e9;grid=on;ylim=0,100;linewidth=2");
  });

  it("a wired input overrides the inline literal", () => {
    const b = new ChartBuilderNode();
    b.stringLiterals.title = "inline";
    expect(b.data({ title: ["wired"] })).toEqual({ result: "title=wired" });
  });

  it("an untouched builder emits an empty string", () => {
    expect(new ChartBuilderNode().data({})).toEqual({ result: "" });
  });
});

describe("histogramBins", () => {
  it("counts values into equal-width bins over the data's own range", () => {
    // 0..9 into 5 bins → pairs, with the max landing in the closed last bin
    expect(histogramBins([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 5)).toEqual([2, 2, 2, 2, 2]);
    expect(histogramBins([], 5)).toEqual([]);
    expect(histogramBins([3, 3, 3], 4)).toEqual([3, 0, 0, 0]); // one spike, all in bin 0
  });

  it("a large series doesn't RangeError (iterMin/iterMax, not Math.min/max spread)", () => {
    // A histogram over a big frame column is an ordinary ask; the spread form
    // throws past ~125k args on min/max.
    const N = 200_000;
    const vals = Array.from({ length: N }, (_, i) => i);
    const bins = histogramBins(vals, 10);
    expect(bins).toHaveLength(10);
    expect(bins.reduce((a, b) => a + b, 0)).toBe(N);
  });
});

describe("control nodes", () => {
  it("Date Picker emits its serial, null when unset", () => {
    const d = new DatePickerNode({ value: 46000 });
    expect(d.data()).toEqual({ result: 46000 });
    const empty = new DatePickerNode({ value: 0 });
    expect(empty.data()).toEqual({ result: null });
    // default is today's serial
    const today = new DatePickerNode();
    expect(today.value).toBe(Math.floor(jsDateToSerial(new Date())));
  });

  it("XY Pad outputs its two fractions and round-trips", () => {
    const p = new XYPadNode({ fx: 0.25, fy: 0.75 });
    expect(p.data()).toEqual({ x: 0.25, y: 0.75 });
    const p2 = new XYPadNode(extractInit(p));
    expect(p2.literals.fx).toBe(0.25);
    expect(p2.literals.fy).toBe(0.75);
  });
});

// ─── The 2026-07-16 chart wave ─────────────────────────────────────────────────

const frame = (cols: Array<Pick<FrameColumn, "name" | "type" | "values">>): FrameValue =>
  ({ __frame: true, columns: cols as FrameColumn[] });

describe("quantileSorted / boxplotStats", () => {
  it("linear-interpolated quantiles (PERCENTILE.INC)", () => {
    const s = [1, 2, 3, 4];
    expect(quantileSorted(s, 0)).toBe(1);
    expect(quantileSorted(s, 1)).toBe(4);
    expect(quantileSorted(s, 0.5)).toBe(2.5);
    expect(quantileSorted(s, 0.25)).toBeCloseTo(1.75, 12);
  });

  it("five-number summary with Tukey whiskers + outliers", () => {
    // 1..9 plus a wild 100: IQR fences exclude it → outlier, whisker stops at 9.
    const s = boxplotStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 100])!;
    expect(s.med).toBeCloseTo(5.5, 12);
    expect(s.hi).toBe(9);
    expect(s.outliers).toEqual([100]);
    expect(boxplotStats([null, null])).toBeNull();
    // Nulls are skipped, not zeroes.
    expect(boxplotStats([null, 5, null])!.med).toBe(5);
  });
});

describe("chart-wave nodes emit their payloads", () => {
  it("Contour reads the bordered grid and clamps levels", () => {
    const n = new ContourNode();
    const grid = [[null, 0, 1], [0, 5, 6], [1, 7, 8]];
    const p = n.data({ grid: [grid], levels: [99] }).chart.payload as ContourPayload;
    expect(p.kind).toBe("contour");
    expect(p.xs).toEqual([0, 1]);
    expect(p.ys).toEqual([0, 1]);
    expect(p.z).toEqual([[5, 6], [7, 8]]);
    expect(p.levels).toBe(24); // clamped
  });

  it("Waterfall pairs labels with deltas and flags the computed total", async () => {
    const n = new WaterfallNode();
    const f = frame([
      { name: "Item", type: "string", values: ["Rev", "COGS", "Opex"] },
      { name: "Δ", type: "number", values: [100, -40, -25] },
    ]);
    const p = (await n.data({ frame: [f] })).chart.payload as WaterfallPayload;
    expect(p.names).toEqual(["Rev", "COGS", "Opex"]);
    expect(p.values).toEqual([100, -40, -25]);
    expect(p.total).toBe(true);
  });

  it("Candlestick: 5 columns → date labels; 4 columns → 1-based index labels", async () => {
    const n = new CandlestickNode();
    const withDates = frame([
      { name: "Date", type: "string", values: ["Jan", "Feb"] },
      { name: "O", type: "number", values: [10, 12] },
      { name: "H", type: "number", values: [15, 13] },
      { name: "L", type: "number", values: [9, 11] },
      { name: "C", type: "number", values: [12, 11] },
    ]);
    const p1 = (await n.data({ frame: [withDates] })).chart.payload as CandlePayload;
    expect(p1.labels).toEqual(["Jan", "Feb"]);
    expect(p1.open).toEqual([10, 12]);
    expect(p1.close).toEqual([12, 11]);
    const bare = frame([
      { name: "O", type: "number", values: [10] },
      { name: "H", type: "number", values: [15] },
      { name: "L", type: "number", values: [9] },
      { name: "C", type: "number", values: [12] },
    ]);
    const p2 = (await n.data({ frame: [bare] })).chart.payload as CandlePayload;
    expect(p2.labels).toEqual(["1"]);
    expect(p2.high).toEqual([15]);
  });

  it("Boxplot: one box per numeric frame column; a plain list gets one box", async () => {
    const n = new BoxplotNode();
    const f = frame([
      { name: "City", type: "string", values: ["a", "b", "c", "d", "e"] },
      { name: "Temp", type: "number", values: [1, 2, 3, 4, 5] },
      { name: "Wind", type: "number", values: [10, 20, 30, 40, 50] },
    ]);
    const p = (await n.data({ values: [f] })).chart.payload as BoxplotPayload;
    expect(p.boxes.map((b) => b.name)).toEqual(["Temp", "Wind"]);
    expect(p.boxes[0].med).toBe(3);
    const pl = (await n.data({ values: [[1, 2, 3]] })).chart.payload as BoxplotPayload;
    expect(pl.boxes).toHaveLength(1);
    expect(pl.boxes[0].med).toBe(2);
  });

  it("Calendar keeps date SERIALS (not formatted text) and pairs values", async () => {
    const n = new CalendarHeatmapNode();
    const f = frame([
      { name: "Day", type: "date", values: [45000, 45001, null] },
      { name: "N", type: "number", values: [3, 5, 7] },
    ]);
    const p = (await n.data({ frame: [f] })).chart.payload as CalHeatPayload;
    expect(p.days).toEqual([45000, 45001]); // the null day drops WITH its value
    expect(p.values).toEqual([3, 5]);
  });

  it("Waffle carries label/value pairs", async () => {
    const n = new WaffleNode();
    const f = frame([
      { name: "Part", type: "string", values: ["A", "B"] },
      { name: "Share", type: "number", values: [3, 1] },
    ]);
    const p = (await n.data({ frame: [f] })).chart.payload as WafflePayload;
    expect(p.names).toEqual(["A", "B"]);
    expect(p.values).toEqual([3, 1]);
  });

  it("Vector Field normalizes both component matrices, keeping nulls as holes", () => {
    const n = new QuiverNode();
    const p = n.data({ u: [[[1, null], [0, 2]]], v: [[[0, 1], [null, 2]]] }).chart.payload as QuiverPayload;
    expect(p.u).toEqual([[1, null], [0, 2]]);
    expect(p.v).toEqual([[0, 1], [null, 2]]);
  });
});

describe("SevenSeg", () => {
  it("emits a chart value carrying the rendered text; clamps decimals", () => {
    const n = new SevenSegNode();
    const out = n.data({ value: [42.5], decimals: [1] });
    expect(out.chart).toMatchObject({ __chart: true, op: "sevenseg", values: 42.5, payload: { kind: "sevenseg", text: "42.5" } });
    expect(n.literals.decimals).toBe(1);
    n.data({ value: [1], decimals: [99] });
    expect(n.literals.decimals).toBe(6);
  });

  it("sevenSegText: fixed decimals; overflow → all dashes; blank when no value", () => {
    expect(sevenSegText(42.5, 1)).toBe("42.5");
    expect(sevenSegText(-3, 0)).toBe("-3");
    expect(sevenSegText(null, 2)).toBe("");
    // 12345678901 = 11 digit cells > 10 → the classic overflow dashes.
    expect(sevenSegText(12345678901, 0)).toBe("----------");
    // The decimal point rides its neighbour cell, so 8 digits + dp still fits.
    expect(sevenSegText(1234567.8, 1)).toBe("1234567.8");
  });
});
