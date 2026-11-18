// [[C24]] arraySemantics, [[C44]] dateSerials, [[B11]] maximalMerge, [[frame-verbs#Type inference]], [[frame-verbs#Building a Frame]]
import { describe, it, expect } from "vitest";
import { frameFromCells, frameFromRecords, frameFromColumnar, frameFromRows, formatFrameCell } from "../../src/graph/frame";
import { jsDateToSerial } from "../../src/graph/nodes/date";

const ser = (y: number, m: number, d: number) => jsDateToSerial(new Date(Date.UTC(y, m - 1, d)));

describe("formatFrameCell", () => {
  it("formatFrameCell renders a date column's serial as a date string", () => {
    expect(formatFrameCell("date", ser(2026, 1, 3))).toBe("03-Jan-2026");
    expect(formatFrameCell("number", 46025)).toBe(46025); // non-date passes through
  });
});

describe("type-inferring frame builders", () => {
  it("array-of-records → ordered-union columns with inferred types", () => {
    const f = frameFromRecords([{ a: 1, b: "x" }, { a: 2, b: "y", c: 9 }]);
    expect(f.columns.map((c) => c.name)).toEqual(["a", "b", "c"]);
    expect(f.columns[0].type).toBe("number");
    expect(f.columns[1].type).toBe("string");
    expect(f.columns[2].values).toEqual([null, 9]); // missing in row 1 → null
  });

  it("array-of-arrays → positional columns (Col1, Col2…)", () => {
    const f = frameFromRows([[1, "a"], [2, "b"]]);
    expect(f.columns[0].type).toBe("number");
    expect(f.columns[1]).toMatchObject({ type: "string", values: ["a", "b"] });
  });

  it("columnar object → one column per key", () => {
    const f = frameFromColumnar({ n: [1, 2], label: ["a", "b"] });
    expect(f.columns[1]).toMatchObject({ name: "label", type: "string", values: ["a", "b"] });
  });

  it("a blank-only column is all null", () => {
    const f = frameFromCells(["x"], [[""], [""]]);
    expect(f.columns[0].values).toEqual([null, null]);
  });
});
