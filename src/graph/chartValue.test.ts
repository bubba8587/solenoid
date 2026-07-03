import { describe, it, expect } from "vitest";
import { isChartValue, type ChartValue } from "./chartValue";
import { ChartNode } from "./nodes/visual";

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
});
