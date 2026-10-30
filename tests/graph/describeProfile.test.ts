// [[C127]] pivotView
import { describe, it, expect } from "vitest";
import { describeTilesOf } from "../../src/graph/describeProfile";
import { carryFrameSidecars } from "../../src/graph/frameSidecar";
import { DescribeNode } from "../../src/graph/nodes/frame";
import type { FrameValue } from "../../src/graph/frame";

const n = 40;
const src: FrameValue = {
  __frame: true,
  columns: [
    { name: "Amt", type: "number", values: Array.from({ length: n }, (_, i) => (i === 3 ? null : i * 2.5)) },
    { name: "Year", type: "number", values: Array.from({ length: n }, (_, i) => 2024 + (i % 2)) },
    { name: "Day", type: "date", values: Array.from({ length: n }, (_, i) => 45000 + i) },
    { name: "Fruit", type: "string", values: Array.from({ length: n }, (_, i) => ["apple", "pear", "fig", "kiwi", "plum", "lime", "date"][i % 7 === 6 ? 0 : i % 7]) },
    { name: "Ok", type: "logical", values: Array.from({ length: n }, (_, i) => (i < 30 ? true : i < 38 ? false : null)) },
  ],
};

function summaryOf(f: FrameValue): FrameValue {
  return new DescribeNode().data({ frame: [f] }).frame as FrameValue;
}

describe("Describe's dashboard tiles", () => {
  const summary = summaryOf(src);
  const tiles = describeTilesOf(summary)!;

  it("come from the Describe node's own pass, one per source column", () => {
    expect(tiles.map((t) => t.name)).toEqual(["Amt", "Year", "Day", "Fruit", "Ok"]);
  });

  it("take the summary's counts and draw a number column as a histogram and a line", () => {
    const amt = tiles[0];
    expect(amt).toMatchObject({ name: "Amt", type: "number", count: 39, blank: 1, distinct: 39 });
    // Sturges' rule over 39 values, kept between 5 and 20 bins.
    expect(amt.hist!.counts.length).toBe(7);
    expect(amt.hist!.counts.reduce((a, b) => a + b, 0)).toBe(39);
    expect(amt.hist).toMatchObject({ min: 0, max: 97.5 });
    expect(amt.trend).toHaveLength(39);
    expect(amt.mean).toBeCloseTo(summary.columns.find((c) => c.name === "mean")!.values[0] as number);
    expect(amt.top).toBeUndefined();
  });

  it("average a long column's line into 40 points", () => {
    const long: FrameValue = { __frame: true, columns: [{ name: "x", type: "number", values: Array.from({ length: 400 }, (_, i) => i) }] };
    const [x] = describeTilesOf(summaryOf(long))!;
    expect(x.trend).toHaveLength(40);
    expect(x.trend![0]).toBe(4.5);
    expect(x.hist!.counts.length).toBe(10);
  });

  it("list a number column's values when it has few", () => {
    expect(tiles[1].hist).toBeUndefined();
    expect(tiles[1].top!.values).toEqual([{ text: "2024", count: 20 }, { text: "2025", count: 20 }]);
    expect(tiles[1].distinct).toBeLessThanOrEqual(6);
  });

  it("bin a date column without a line", () => {
    expect(tiles[2].hist).toMatchObject({ min: 45000, max: 45039 });
    expect(tiles[2].trend).toBeUndefined();
  });

  it("rank text and logical values, most first and ties by name, and count the rest", () => {
    expect(tiles[3].top!.values.map((v) => v.text)).toEqual(["apple", "fig", "kiwi", "pear", "plum"]);
    expect(tiles[3].top!.values[0].count).toBe(11);
    expect(tiles[3].top!.other).toBe(5);
    expect(tiles[4].top).toEqual({ values: [{ text: "TRUE", count: 30 }, { text: "FALSE", count: 8 }], other: 0 });
  });

  it("ride beside the summary, through a format stamp's copy, and nowhere else", () => {
    const stamped = { ...summary, columns: summary.columns.map((c) => ({ ...c })) };
    carryFrameSidecars(summary, stamped);
    expect(describeTilesOf(stamped)).toBe(describeTilesOf(summary));
    expect(describeTilesOf({ ...summary })).toBeNull();
    const cut = { ...summary, columns: summary.columns.map((c) => ({ ...c, values: c.values.slice(1) })) };
    carryFrameSidecars(summary, cut);
    expect(describeTilesOf(cut)).toBeNull();
  });
});
