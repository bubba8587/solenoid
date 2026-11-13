// [[B11]] maximalMerge, [[reports-and-notes#A box]]
// A Dashboard box's Filter: which values carry one, and a table's rows narrowed over the whole table.
import { describe, it, expect } from "vitest";
import { boxFilterKind, filterFrameRows, boxFilterCount } from "../../src/graph/components/boxFilter";
import type { FrameValue } from "../../src/graph/frame";

const frame = (n: number): FrameValue => ({
  __frame: true,
  columns: [
    { name: "City", type: "string", values: Array.from({ length: n }, (_, i) => (i % 3 === 0 ? `Oslo ${i}` : `Lima ${i}`)) },
    { name: "Pop", type: "number", values: Array.from({ length: n }, (_, i) => i * 10) },
  ],
} as unknown as FrameValue);

describe("a Dashboard box's Filter", () => {
  it("is on a table, absent on a number or a plain chart", () => {
    expect(boxFilterKind(frame(3), undefined)).toBe("rows");
    expect(boxFilterKind(42, undefined)).toBeNull();
    expect(boxFilterKind({ __chart: true, op: "line", series: [] }, undefined)).toBeNull();
  });

  it("keeps the rows holding every word, past the 25 a box draws", () => {
    const f = filterFrameRows(frame(90), "oslo");
    expect(f.total).toBe(90);
    expect(f.matched).toBe(30);
    expect(f.frame.columns[0].values.every((v) => String(v).startsWith("Oslo"))).toBe(true);
    expect(filterFrameRows(frame(90), "oslo 6").matched).toBe(6); // Oslo 6, 36, 60, 63, 66 and 69
    expect(boxFilterCount("rows", frame(90), "oslo", undefined)).toBe("30 of 90");
  });

  it("reads a number as the box shows it, and a blank query leaves the table as it is", () => {
    expect(filterFrameRows(frame(12), "110").matched).toBe(1);
    const f = frame(5);
    expect(filterFrameRows(f, "  ").frame).toBe(f);
    expect(boxFilterCount("rows", f, "", undefined)).toBeUndefined();
  });
});
