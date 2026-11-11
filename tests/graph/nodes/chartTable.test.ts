// [[C100]] chartIsAValue
import { describe, it, expect } from "vitest";
import { ChartNode } from "../../../src/graph/nodes/visual";
import type { ChartValue } from "../../../src/graph/chartValue";

const chartOf = (op: "column" | "xyline", values: unknown) => new ChartNode({ op }).data({ values: [values] }).chart as ChartValue;

describe("a Chart fed a table", () => {
  it("plots it as the frame of its columns: the first labels, each number column after it a series", () => {
    const c = chartOf("column", [["Q1", 10, 4], ["Q2", 20, 5], ["Q3", 15, 6]]);
    expect(c.labels).toEqual(["Q1", "Q2", "Q3"]);
    expect(c.values).toEqual([10, 20, 15]);
    expect(c.series?.map((s) => s.values)).toEqual([[10, 20, 15], [4, 5, 6]]);
  });
  it("a one-column table plots by position and a one-row table as its list", () => {
    expect(chartOf("column", [[3], [1], [2]]).values).toEqual([3, 1, 2]);
    expect(chartOf("column", [[3, 1, 2]]).values).toEqual([3, 1, 2]);
  });
  it("an XY chart takes the first two number columns as x and y", () => {
    const c = chartOf("xyline", [[0, 0], [1, 1], [2, 4]]);
    const points = (c.payload as { series: { points: { x: number; y: number }[] }[] }).series[0].points;
    expect(points.map((p) => [p.x, p.y])).toEqual([[0, 0], [1, 1], [2, 4]]);
  });
});
