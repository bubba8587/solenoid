import { describe, it, expect } from "vitest";
import { SparklineNode, ChartNode, MermaidNode, GaugeNode, HeatmapCellNode, ChartBuilderNode } from "./visual";
import { DatePickerNode, XYPadNode } from "./control";
import { extractInit } from "../copyPaste";
import { jsDateToSerial } from "./date";
import { isMermaidValue } from "../mermaidValue";

describe("visual nodes", () => {
  it("Sparkline passes the list through; Chart emits a first-class chart value", () => {
    const sp = new SparklineNode({ op: "column" });
    expect(sp.op).toBe("column");
    expect(sp.data({ values: [[1, 2, 3]] })).toEqual({ result: [1, 2, 3] });
    expect(sp.data({})).toEqual({ result: null });
    // legacy "bar" migrates to "column"
    expect(new SparklineNode({ op: "bar" as "column" }).op).toBe("column");

    // A Chart is a terminal figure — its output is the `chart` object value
    // (op + values + options), the thing a Report renders inline, NOT a
    // numlist pass-through (nothing consumed that; a chart is a sink).
    const ch = new ChartNode({ op: "line" });
    expect(ch.data({ values: [[4, 5]] })).toEqual({
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

  it("Gauge passes the value through and mirrors live min/max", () => {
    const g = new GaugeNode();
    expect(g.data({ value: [42], min: [0], max: [50] })).toEqual({ result: 42 });
    expect(g.literals.min).toBe(0);
    expect(g.literals.max).toBe(50);
    // unwired value → literal fallback (0)
    expect(g.data({})).toEqual({ result: 0 });
  });

  it("Heatmap passes a Table straight through", () => {
    const h = new HeatmapCellNode();
    expect(h.data({ table: [[[1, 2], [3, 4]]] })).toEqual({ result: [[1, 2], [3, 4]] });
    expect(h.data({})).toEqual({ result: null });
  });

  it("op + literals round-trip through extractInit", () => {
    const sp = new SparklineNode({ op: "area" });
    const sp2 = new SparklineNode(extractInit(sp));
    expect(sp2.op).toBe("area");

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
