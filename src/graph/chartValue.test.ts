import { describe, it, expect } from "vitest";
import { isChartValue, type ChartValue } from "./chartValue";
import { ChartNode } from "./nodes/visual";
import { solError } from "./errorValue";
import type { FrameValue } from "./frame";

describe("chart value", () => {
  it("isChartValue recognizes a chart, rejects lookalikes", () => {
    const c: ChartValue = { __chart: true, op: "column", values: [1, 2], options: {}, title: "X" };
    expect(isChartValue(c)).toBe(true);
    expect(isChartValue(null)).toBe(false);
    expect(isChartValue([1, 2, 3])).toBe(false);
    expect(isChartValue({ __frame: true })).toBe(false);
    expect(isChartValue(42)).toBe(false);
    expect(isChartValue("chart")).toBe(false);
  });

  it("ChartNode emits a chart value carrying its op, values, parsed options and title", () => {
    const ch = new ChartNode({ op: "line", label: "Revenue" });
    const out = ch.data({ values: [[10, 20, 30]], options: ["title=Growth;color=red"] });
    expect(isChartValue(out.chart)).toBe(true);
    expect(out.chart).toMatchObject({
      __chart: true,
      op: "line",
      values: [10, 20, 30],
      options: { title: "Growth", color: "red" },
      title: "Growth", // the Options title wins over the node label
    });
  });

  it("falls back to the node label for the title when Options has none", () => {
    const ch = new ChartNode({ label: "Weekly sales" });
    const out = ch.data({ values: [[1]] });
    expect(out.chart.title).toBe("Weekly sales");
  });

  // ─── Sanitization (2026-07-17) ──────────────────────────────────────────────
  // A #DIV/0! or dirty-data cell wired into a Chart must never crash it or ride
  // out the chart socket as a SolError — it renders as an empty "no data" figure.

  it("a scalar #DIV/0! into the Data socket yields a valid EMPTY chart, not a SolError", () => {
    const ch = new ChartNode({ op: "column", label: "C" });
    const out = ch.data({ values: [solError("#DIV/0!", "Division by zero")] });
    // Still a chart value (the socket carries a figure, never a bare error object).
    expect(isChartValue(out.chart)).toBe(true);
    expect(out.chart.values).toBeNull();
  });

  it("list cells that are errors / NaN / text become null in place (row positions kept)", () => {
    const ch = new ChartNode({ op: "line" });
    const out = ch.data({ values: [[1, solError("#DIV/0!", "x"), NaN, "text", 5]] });
    expect(out.chart.values).toEqual([1, null, null, null, 5]);
  });

  it("a matrix with error / non-number cells coerces them to null", () => {
    const ch = new ChartNode({ op: "composed" });
    const out = ch.data({ series: [[[1, solError("#N/A", "x")], [3, Infinity]]] });
    expect(out.chart.matrix).toEqual([[1, null], [3, null]]);
  });

  it("a Frame drives labels (col 0) + values (col 1); error/blank value cells → null, labels aligned", () => {
    const frame: FrameValue = {
      __frame: true,
      columns: [
        { name: "Month", type: "string", values: ["Jan", "Feb", "Mar"] },
        { name: "Sales", type: "number", values: [10, solError("#DIV/0!", "x"), 30] },
      ],
    };
    const ch = new ChartNode({ op: "column" });
    const out = ch.data({ values: [frame] });
    expect(out.chart.values).toEqual([10, null, 30]);
    expect(out.chart.labels).toEqual(["Jan", "Feb", "Mar"]);
    expect(out.chart.series).toBeUndefined(); // one numeric column → no legend
  });

  it("a Frame with a label column + 2 numeric columns → values = first series, series = both named", () => {
    const frame: FrameValue = {
      __frame: true,
      columns: [
        { name: "Month", type: "string", values: ["Jan", "Feb"] },
        { name: "Sales", type: "number", values: [10, 20] },
        { name: "Target", type: "number", values: [12, 18] },
      ],
    };
    const out = new ChartNode({ op: "column" }).data({ values: [frame] });
    expect(out.chart.labels).toEqual(["Jan", "Feb"]);
    expect(out.chart.values).toEqual([10, 20]); // first series mirrors values
    expect(out.chart.series).toEqual([
      { name: "Sales", values: [10, 20] },
      { name: "Target", values: [12, 18] },
    ]);
  });

  it("a number-first Frame has no label column — every numeric column is a series (positional x)", () => {
    const frame: FrameValue = {
      __frame: true,
      columns: [
        { name: "A", type: "number", values: [1, 2, 3] },
        { name: "B", type: "number", values: [4, 5, 6] },
      ],
    };
    const out = new ChartNode({ op: "line" }).data({ values: [frame] });
    expect(out.chart.labels).toBeUndefined();
    expect(out.chart.values).toEqual([1, 2, 3]);
    expect(out.chart.series).toEqual([
      { name: "A", values: [1, 2, 3] },
      { name: "B", values: [4, 5, 6] },
    ]);
  });

  it("non-number columns after the label are skipped, not errors", () => {
    const frame: FrameValue = {
      __frame: true,
      columns: [
        { name: "Month", type: "string", values: ["Jan", "Feb"] },
        { name: "Sales", type: "number", values: [10, 20] },
        { name: "Note", type: "string", values: ["ok", "hi"] },
        { name: "Target", type: "number", values: [12, 18] },
      ],
    };
    const out = new ChartNode({ op: "column" }).data({ values: [frame] });
    expect(out.chart.series?.map((s) => s.name)).toEqual(["Sales", "Target"]);
  });

  it("a SolError wired into the Options socket is ignored (not parsed as text)", () => {
    const ch = new ChartNode({ op: "bar", label: "C" });
    const out = ch.data({ values: [[1, 2]], options: [solError("#VALUE!", "x") as unknown as string] });
    expect(isChartValue(out.chart)).toBe(true);
    expect(out.chart.options).toEqual({});
    expect(out.chart.title).toBe("C"); // node label, since Options gave no title
  });
});
