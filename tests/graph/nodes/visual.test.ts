import { describe, it, expect } from "vitest";
import {
  SparklineNode, ChartNode, MermaidNode, GaugeNode, HeatmapCellNode, ChartBuilderNode, SurfaceNode, histogramBins, histogram2d,
  WaterfallNode, CandlestickNode, BoxplotNode, CalendarHeatmapNode, ProportionNode, QuiverNode,
  SevenSegNode, sevenSegText, boxplotStats, quantileSorted,
  RecordNode, parseRecordLayout, recordImageSrc,
} from "../../../src/graph/nodes/visual";
import { CHART_BUILDER_FIELDS } from "../../../src/graph/nodes/visual";
import { CHART_BUILDER_TARGETS, CHART_TARGET_LIST } from "../../../src/graph/nodes/chartOptions";
import type { BoxplotPayload, CandlePayload, ContourPayload, WaterfallPayload, CalHeatPayload, ProportionPayload, QuiverPayload, RecordPayload } from "../../../src/graph/chartValue";
import type { FrameValue, FrameColumn } from "../../../src/graph/frame";
import { DateInputNode, XYPadNode } from "../../../src/graph/nodes/control";
import { extractInit } from "../../../src/graph/copyPaste";
import { jsDateToSerial, parseDate } from "../../../src/graph/nodes/date";
import { isSolError } from "../../../src/graph/errorValue";
import { isMermaidValue } from "../../../src/graph/mermaidValue";

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
      // A plain list gives no labels/series — just the values figure.
      chart: { __chart: true, op: "line", values: [4, 5], options: {}, title: "Chart" },
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

  it("Gauge (Dial) emits a scale chart payload — value read as a fraction of 1", () => {
    const g = new GaugeNode();
    const out = g.data({ value: [1.5] }).chart;
    expect(out.op).toBe("scale");
    expect(out.payload).toMatchObject({ kind: "scale", style: "dial", value: 1.5, target: null, min: 0, max: 1 });
    // unwired value → literal fallback (0)
    expect((g.data({}).chart.payload as { value: number }).value).toBe(0);
  });

  it("Gauge (Bar) emits a bar payload with target and 0→Max track (the former Bullet)", () => {
    const g = new GaugeNode({ op: "bar" });
    const out = g.data({ value: [42], target: [80], max: [200] }).chart;
    expect(out.payload).toMatchObject({ kind: "scale", style: "bar", value: 42, target: 80, min: 0, max: 200 });
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

    const g = new GaugeNode({ op: "bar" });
    const init = extractInit(g);
    expect(init.op).toBe("bar");
    expect(new GaugeNode(init as { op: "bar" }).op).toBe("bar");
  });
});

describe("Surface (3-D plot)", () => {
  it("emits a surface ChartValue carrying the Z table + wired axes + default view angles", () => {
    const s = new SurfaceNode({ label: "Heights" });
    const out = s.data({ z: [[[1, 2], [3, 4]]], xs: [[0, 10]], ys: [[0, 5]] });
    expect(out.chart).toMatchObject({
      __chart: true,
      op: "surface",
      title: "Heights",
      payload: { kind: "surface", xs: [0, 10], ys: [0, 5], z: [[1, 2], [3, 4]], yaw: 45, pitch: 45 },
    });
  });

  it("unwired axes count 1, 2, 3… beside the Z table", () => {
    const out = new SurfaceNode().data({ z: [[[1, 2], [3, 4]]] });
    expect(out.chart.payload).toMatchObject({ kind: "surface", xs: [1, 2], ys: [1, 2], z: [[1, 2], [3, 4]] });
  });

  it("a bad axis (wrong length / non-finite) collapses the figure to an empty grid", () => {
    const badLen = new SurfaceNode().data({ z: [[[1, 2], [3, 4]]], xs: [[0, 10, 20]] }).chart;
    expect(badLen.payload).toMatchObject({ xs: [], ys: [], z: [] });
    const badNum = new SurfaceNode().data({ z: [[[1, 2]]], xs: [[NaN, 1]] }).chart;
    expect(badNum.payload).toMatchObject({ xs: [], ys: [], z: [] });
    // No Z at all → empty, still a valid (drawable-as-empty) surface value.
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

  it("target round-trips through extractInit; a stale target falls back to chart", () => {
    const b = new ChartBuilderNode({ target: "kpi" });
    const init = extractInit(b);
    expect(init.target).toBe("kpi");
    expect(new ChartBuilderNode(init as { target?: never }).target).toBe("kpi");
    expect(new ChartBuilderNode({ target: "gone" as never }).target).toBe("chart");
  });

  it("serialization ignores the target — set fields always emit", () => {
    const b = new ChartBuilderNode({ target: "proportion" });
    b.stringLiterals.title = "T";
    b.stringLiterals.color = "#123456"; // inert for proportion, still serialized
    expect(b.data({})).toEqual({ result: "title=T;color=#123456" });
  });

  it("every target key is a real builder field, and every target reads title", () => {
    const fields = new Set<string>([...CHART_BUILDER_FIELDS.str, ...CHART_BUILDER_FIELDS.num]);
    for (const { id, keys } of CHART_TARGET_LIST) {
      for (const k of keys) expect(fields.has(k), `${id}:${k}`).toBe(true);
      expect(keys).toContain("title");
    }
    // The default target accepts the full field set (today's whole form).
    expect(new Set(CHART_BUILDER_TARGETS.chart.keys)).toEqual(fields);
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

describe("histogram2d (numpy histogram2d)", () => {
  it("tallies paired samples into an x-bin × y-bin grid; last edge inclusive", () => {
    // A 2×2 grid over [0,2]×[0,2]: (0,0) low-low, (1,1)+(2,2) hit the closed upper bin.
    const h = histogram2d([0, 1, 2, 0], [0, 1, 2, 2], 2, 2)!;
    expect(h.counts).toEqual([[1, 1], [0, 2]]); // counts[xBin][yBin]
    expect(h.xEdges).toEqual([0, 1]);
    expect(h.yEdges).toEqual([0, 1]);
  });

  it("skips a pair when either coordinate is non-finite (numpy drops NaN pairs)", () => {
    const h = histogram2d([0, null, 2], [0, 5, 2], 2, 2)!;
    // Only (0,0) and (2,2) survive → one in each diagonal corner.
    expect(h.counts).toEqual([[1, 0], [0, 1]]);
  });

  it("an axis whose values are all equal collapses to one bin (single-spike rule)", () => {
    const h = histogram2d([5, 5, 5], [0, 1, 2], 4, 2)!;
    expect(h.xEdges).toHaveLength(1); // x collapsed
    expect(h.counts).toEqual([[1, 2]]); // one x row; y=0 → bin 0, y=1 and y=2 → the closed bin 1
  });

  it("no finite pair → null", () => {
    expect(histogram2d([null, null], [1, 2], 2, 2)).toBeNull();
    expect(histogram2d([], [], 2, 2)).toBeNull();
  });

});

describe("control nodes", () => {
  it("Date Input derives its serial from the raw source text", () => {
    expect(new DateInputNode({ date: "20-Mar-2026" }).data().result).toBe(Math.floor(parseDate("20-Mar-2026") as number));
    expect(new DateInputNode({ date: "" }).data()).toEqual({ result: null });
    expect(new DateInputNode({ date: "not a date" }).data()).toEqual({ result: null });
    // default is today's serial
    expect(new DateInputNode().data().result).toBe(Math.floor(jsDateToSerial(new Date())));
  });
  it("Date Input keeps the raw text verbatim and surfaces #AMBIGUOUS! instead of guessing", () => {
    const d = new DateInputNode({ date: "20-mar-2026" });
    expect(d.stringLiterals.date).toBe("20-mar-2026"); // raw is the source of truth
    const amb = new DateInputNode({ date: "3/4/2026" }).data().result;
    expect(isSolError(amb) && amb.code).toBe("#AMBIGUOUS!");
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
  it("Contour reads the Z table + axes and clamps levels", () => {
    const n = new SurfaceNode({ op: "contour" });
    const p = n.data({ z: [[[5, 6], [7, 8]]], xs: [[0, 1]], ys: [[0, 1]], levels: [99] }).chart.payload as ContourPayload;
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

  it("Proportion carries label/value pairs and defaults to the treemap layout", async () => {
    const n = new ProportionNode();
    const f = frame([
      { name: "Part", type: "string", values: ["A", "B"] },
      { name: "Share", type: "number", values: [3, 1] },
    ]);
    const chart = (await n.data({ frame: [f] })).chart;
    expect(chart.op).toBe("proportion");
    const p = chart.payload as ProportionPayload;
    expect(p.layout).toBe("treemap");
    expect(p.names).toEqual(["A", "B"]);
    expect(p.values).toEqual([3, 1]);
  });

  it("Proportion emits the waffle layout when its op is waffle, round-tripping through extractInit", async () => {
    const n = new ProportionNode({ op: "waffle" });
    const f = frame([{ name: "Part", type: "string", values: ["A"] }, { name: "Share", type: "number", values: [1] }]);
    expect(((await n.data({ frame: [f] })).chart.payload as ProportionPayload).layout).toBe("waffle");
    const n2 = new ProportionNode(extractInit(n));
    expect(n2.op).toBe("waffle");
    n2.setOp("treemap");
    expect(((await n2.data({ frame: [f] })).chart.payload as ProportionPayload).layout).toBe("treemap");
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
    // A WIRED decimals renders with the wired value but never clobbers the card's
    // typed literal (the KPI/Bullet mirror-only-when-unwired pattern).
    expect(n.literals.decimals).toBe(0);
    // Unwired: the card's own out-of-range literal normalizes (clamped to 6).
    n.literals.decimals = 99;
    n.data({ value: [1] });
    expect(n.literals.decimals).toBe(6);
  });

  it("sevenSegText: fixed decimals; overflow → all dashes; blank when no value", () => {
    expect(sevenSegText(42.5, 1)).toBe("42.5");
    expect(sevenSegText(-3, 0)).toBe("-3");
    expect(sevenSegText(null, 2)).toBe("");
    // 12345678901 = 11 digit cells > 10 → the classic overflow dashes.
    expect(sevenSegText(12345678901, 0)).toBe("----------");
    // The decimal point rides its neighbor cell, so 8 digits + dp still fits.
    expect(sevenSegText(1234567.8, 1)).toBe("1234567.8");
  });
});

describe("Surface — the 3-D / Flat view toggle (old Contour)", () => {
  it("the toggle swaps the payload kind and owns the Levels socket", () => {
    const n = new SurfaceNode();
    expect(Object.keys(n.inputs)).toEqual(["z", "xs", "ys"]);
    n.setOp("contour");
    expect(Object.keys(n.inputs)).toEqual(["z", "xs", "ys", "levels"]);
    expect(n.literals.levels).toBe(8);
    const z = [[10, 20], [30, 40]];
    expect(n.data({ z: [z] }).chart).toMatchObject({ op: "contour", payload: { kind: "contour", levels: 8 } });
    n.setOp("surface");
    expect(Object.keys(n.inputs)).toEqual(["z", "xs", "ys"]);
    expect(n.data({ z: [z] }).chart).toMatchObject({ op: "surface", payload: { kind: "surface", yaw: 45 } });
  });

  it("op round-trips through extractInit with the view's literals", () => {
    const n = new SurfaceNode({ op: "contour", levels: 12 });
    const clone = new SurfaceNode(extractInit(n) as { op: "contour" });
    expect(clone.op).toBe("contour");
    expect(clone.literals.levels).toBe(12);
  });
});

describe("Record node", () => {
  it("parseRecordLayout: rows on lines, cells on |, gaps, merges, ragged rows", () => {
    const placed = parseRecordLayout("Name | Name | Photo\nPrice | Qty | Photo\nNotes");
    expect(placed).toEqual([
      { name: "Name", row: 1, col: 1, rowSpan: 1, colSpan: 2 },
      { name: "Photo", row: 1, col: 3, rowSpan: 2, colSpan: 1 },
      { name: "Price", row: 2, col: 1, rowSpan: 1, colSpan: 1 },
      { name: "Qty", row: 2, col: 2, rowSpan: 1, colSpan: 1 },
      { name: "Notes", row: 3, col: 1, rowSpan: 1, colSpan: 1 },
    ]);
    // "." and empty cells are gaps; blank-only lines drop out entirely.
    expect(parseRecordLayout("A | . | B\n\n . | C")).toEqual([
      { name: "A", row: 1, col: 1, rowSpan: 1, colSpan: 1 },
      { name: "B", row: 1, col: 3, rowSpan: 1, colSpan: 1 },
      { name: "C", row: 2, col: 2, rowSpan: 1, colSpan: 1 },
    ]);
    // Case-insensitive dedup keeps the first spelling; a non-rectangular repeat
    // degrades to its bounding rectangle.
    expect(parseRecordLayout("Qty | .\n. | QTY")).toEqual([
      { name: "Qty", row: 1, col: 1, rowSpan: 2, colSpan: 2 },
    ]);
  });

  it("parseRecordLayout: *N widens a cell and shifts later cells right", () => {
    expect(parseRecordLayout("Item | Photo*2 | Qty")).toEqual([
      { name: "Item", row: 1, col: 1, rowSpan: 1, colSpan: 1 },
      { name: "Photo", row: 1, col: 2, rowSpan: 1, colSpan: 2 },
      { name: "Qty", row: 1, col: 4, rowSpan: 1, colSpan: 1 },
    ]);
    // A widened cell still merges with plain repeats on other rows (the seed's
    // Photo shape), and the span is clamped to at least 1.
    expect(parseRecordLayout("A | Photo*2\nB | Photo")).toEqual([
      { name: "A", row: 1, col: 1, rowSpan: 1, colSpan: 1 },
      { name: "Photo", row: 1, col: 2, rowSpan: 2, colSpan: 2 },
      { name: "B", row: 2, col: 1, rowSpan: 1, colSpan: 1 },
    ]);
    expect(parseRecordLayout("A*0 | B")).toEqual([
      { name: "A", row: 1, col: 1, rowSpan: 1, colSpan: 1 },
      { name: "B", row: 1, col: 2, rowSpan: 1, colSpan: 1 },
    ]);
  });

  it("parseRecordLayout: a first colon splits off the box's placeholder hint", () => {
    expect(parseRecordLayout("SKU: e.g. HB-401 | Qty")).toEqual([
      { name: "SKU", row: 1, col: 1, rowSpan: 1, colSpan: 1, hint: "e.g. HB-401" },
      { name: "Qty", row: 1, col: 2, rowSpan: 1, colSpan: 1 },
    ]);
    // The hint composes with *N (span binds to the name), and the first
    // authored hint wins across repeats.
    expect(parseRecordLayout("Photo*2: paste an image URL\nPhoto*2: ignored")).toEqual([
      { name: "Photo", row: 1, col: 1, rowSpan: 2, colSpan: 2, hint: "paste an image URL" },
    ]);
    expect(parseRecordLayout("Notes | notes: added later")).toEqual([
      { name: "Notes", row: 1, col: 1, rowSpan: 1, colSpan: 2, hint: "added later" },
    ]);
  });

  it("recordImageSrc: data:image and image-extension URLs only", () => {
    expect(recordImageSrc("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    expect(recordImageSrc(" https://x.test/a.JPG?w=2 ")).toBe("https://x.test/a.JPG?w=2");
    expect(recordImageSrc("https://x.test/page.html")).toBeNull();
    expect(recordImageSrc("Bolt M4")).toBeNull();
  });

  it("no layout → the columns stack; row 1 is the default record", async () => {
    const n = new RecordNode();
    const f = frame([
      { name: "Item", type: "string", values: ["Bolt", "Nut"] },
      { name: "Qty", type: "number", values: [40, 120] },
    ]);
    const p = (await n.data({ frame: [f] })).chart.payload as RecordPayload;
    expect(p).toMatchObject({ kind: "record", view: "card", cols: 1, index: 1, total: 2 });
    expect(p.cards[0]).toEqual([
      { label: "Item", value: "Bolt", row: 1, col: 1, rowSpan: 1, colSpan: 1 },
      { label: "Qty", value: 40, row: 2, col: 1, rowSpan: 1, colSpan: 1 },
    ]);
  });

  it("a layout places boxes, matches columns case-insensitively, keeps unknown names", async () => {
    const n = new RecordNode();
    n.stringLiterals.layout = "item | item\nqty | Missing";
    const f = frame([
      { name: "Item", type: "string", values: ["Bolt"] },
      { name: "Qty", type: "number", values: [40] },
    ]);
    const p = (await n.data({ frame: [f] })).chart.payload as RecordPayload;
    expect(p.cols).toBe(2);
    // Matched names take the column's own spelling; an unknown name keeps its
    // box (a draftable layout), just empty.
    expect(p.cards[0]).toEqual([
      { label: "Item", value: "Bolt", row: 1, col: 1, rowSpan: 1, colSpan: 2 },
      { label: "Qty", value: 40, row: 2, col: 1, rowSpan: 1, colSpan: 1 },
      { label: "Missing", value: null, row: 2, col: 2, rowSpan: 1, colSpan: 1 },
    ]);
  });

  it("cells format for display: dates as text, booleans as TRUE/FALSE, nulls empty, images detected", async () => {
    const n = new RecordNode();
    n.literals.row = 2;
    const f = frame([
      { name: "When", type: "date", values: [45000, 45001] },
      { name: "Done", type: "logical", values: [false, true] },
      { name: "Note", type: "string", values: ["x", null] },
      { name: "Photo", type: "string", values: ["p", "https://x.test/b.png"] },
    ]);
    const p = (await n.data({ frame: [f] })).chart.payload as RecordPayload;
    expect(p.index).toBe(2);
    const by = Object.fromEntries(p.cards[0].map((fl) => [fl.label, fl]));
    expect(typeof by.When.value).toBe("string"); // serial formatted to date text
    expect(by.Done.value).toBe("TRUE");
    expect(by.Note.value).toBeNull();
    expect(by.Photo.image).toBe("https://x.test/b.png");
  });

  it("Row is the record pick: a wired blank or out-of-range shows empty boxes; unwired clamps + mirrors", async () => {
    const n = new RecordNode();
    const f = frame([{ name: "A", type: "number", values: [1, 2, 3] }]);
    // Wired blank → no record, boxes stay (labels visible), values empty.
    let p = (await n.data({ frame: [f], row: [null as unknown as number] })).chart.payload as RecordPayload;
    expect(p.index).toBe(0);
    expect(p.cards[0][0]).toMatchObject({ label: "A", value: null });
    // Wired out-of-range → empty too, never clamped to a record the cable didn't pick.
    p = (await n.data({ frame: [f], row: [7] })).chart.payload as RecordPayload;
    expect(p.index).toBe(0);
    // Unwired → the card's literal clamps into range and mirrors back.
    n.literals.row = 99;
    p = (await n.data({ frame: [f] })).chart.payload as RecordPayload;
    expect(p.index).toBe(3);
    expect(n.literals.row).toBe(3);
  });

  it("a layout stands without a frame (draftable), and no inputs at all is empty", async () => {
    const n = new RecordNode();
    n.stringLiterals.layout = "A | B";
    const p = (await n.data({})).chart.payload as RecordPayload;
    expect(p.total).toBe(0);
    expect(p.cards[0].map((fl) => fl.label)).toEqual(["A", "B"]);
    n.stringLiterals.layout = "";
    const empty = (await n.data({})).chart.payload as RecordPayload;
    expect(empty.cards[0]).toEqual([]);
  });

  it("Options styles the figure; label + op round-trip through extractInit", async () => {
    const n = new RecordNode({ label: "Part", op: "gallery" });
    const f = frame([{ name: "A", type: "number", values: [1] }]);
    const out = await n.data({ frame: [f], options: ["title=Sheet"] });
    expect(out.chart.title).toBe("Sheet");
    const clone = new RecordNode(extractInit(n) as { op: "gallery" });
    expect(clone.label).toBe("Part");
    expect(clone.op).toBe("gallery");
    // A stale op from an old save falls back rather than crashing.
    expect(new RecordNode({ op: "kanban" as "board" }).op).toBe("card");
  });

  it("gallery draws every row as a card, capped with a `more` count", async () => {
    const n = new RecordNode({ op: "gallery" });
    const f = frame([{ name: "A", type: "number", values: Array.from({ length: 70 }, (_, i) => i + 1) }]);
    const out = await n.data({ frame: [f] });
    const p = out.chart.payload as RecordPayload;
    expect(p.view).toBe("gallery");
    expect(p.cards.length).toBe(60);
    expect(p.more).toBe(10);
    expect(p.cards[2][0]).toMatchObject({ label: "A", value: 3 });
    // No pick in a gallery.
    expect(p.index).toBe(0);
  });

  it("board groups rows into lanes by the named column, blanks last as an em-dash lane", async () => {
    const n = new RecordNode({ op: "board" });
    n.stringLiterals.by = "status";
    const f = frame([
      { name: "Item", type: "string", values: ["a", "b", "c", "d"] },
      { name: "Status", type: "string", values: ["Open", "Done", "Open", null] },
    ]);
    const p = (await n.data({ frame: [f] })).chart.payload as RecordPayload;
    expect(p.view).toBe("board");
    expect(p.lanes).toEqual([
      { label: "Open", cards: [0, 2] },
      { label: "Done", cards: [1] },
      { label: "—", cards: [3] },
    ]);
    // The default stacked card skips the grouping column (the lane already says it).
    expect(p.cards[0].map((fl) => fl.label)).toEqual(["Item"]);
    // A blank or unmatched grouping column draws nothing.
    n.stringLiterals.by = "nope";
    expect(((await n.data({ frame: [f] })).chart.payload as RecordPayload).cards).toEqual([]);
    n.stringLiterals.by = "Status";
    expect(((await n.data({ frame: [f], by: [null as unknown as string] })).chart.payload as RecordPayload).cards).toEqual([]);
  });

  it("setOp swaps the Row / Group-by sockets with the view", () => {
    const n = new RecordNode();
    expect(Object.keys(n.inputs)).toEqual(["frame", "row", "layout", "options"]);
    n.setOp("gallery");
    expect(Object.keys(n.inputs)).toEqual(["frame", "layout", "options"]);
    n.setOp("board");
    expect(Object.keys(n.inputs)).toEqual(["frame", "layout", "options", "by"]);
    n.setOp("card");
    expect(Object.keys(n.inputs)).toEqual(["frame", "layout", "options", "row"]);
  });
});
