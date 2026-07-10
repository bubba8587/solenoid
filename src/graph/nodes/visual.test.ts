import { describe, it, expect } from "vitest";
import { SparklineNode, ChartNode, MermaidNode, GaugeNode, HeatmapCellNode, ChartBuilderNode, histogramBins } from "./visual";
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
