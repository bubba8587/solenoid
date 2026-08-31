import { describe, it, expect } from "vitest";
import { frameFromCells, frameFromRecords, frameFromColumnar, frameFromRows, inferColumn, frameHasTextColumns, formatFrameCell } from "../../src/graph/frame";
import { jsDateToSerial } from "../../src/graph/nodes/date";

const ser = (y: number, m: number, d: number) => jsDateToSerial(new Date(Date.UTC(y, m - 1, d)));

describe("date column inference (conservative, ISO-only)", () => {
  it("infers an unambiguous ISO date column as type date, storing serials", () => {
    const f = frameFromCells(["When", "Amt"], [["2026-01-03", "10"], ["2026-02-04", "20"]]);
    expect(f.columns[0].type).toBe("date");
    expect((f.columns[0].values as number[]).map(Math.floor)).toEqual([Math.floor(ser(2026, 1, 3)), Math.floor(ser(2026, 2, 4))]);
    expect(f.columns[1].type).toBe("number"); // amounts stay numeric
  });
  it("does NOT mistake bare numbers / years for dates", () => {
    expect(frameFromCells(["Year"], [["2026"], ["2027"]]).columns[0].type).toBe("number");
  });
  it("a column with any non-date string stays text", () => {
    expect(frameFromCells(["X"], [["2026-01-03"], ["hello"]]).columns[0].type).toBe("string");
  });
  it("a date column does NOT block the numeric matrix (it holds serials)", () => {
    const f = frameFromCells(["When", "Amt"], [["2026-01-03", "10"]]);
    expect(frameHasTextColumns(f)).toBe(false); // only genuine string columns block Split
  });
  it("formatFrameCell renders a date column's serial as a date string", () => {
    expect(formatFrameCell("date", ser(2026, 1, 3))).toBe("03-Jan-2026");
    expect(formatFrameCell("number", 46025)).toBe(46025); // non-date passes through
  });
});

// The type-inferring import builders: a column is numeric only when every
// non-blank cell is a finite number (commas stripped); otherwise it's text with
// the original strings kept. This is what lets real-world tables (names,
// categories) survive a CSV/JSON import instead of collapsing to NaN.

describe("type-inferring frame builders", () => {
  it("infers a numeric column and a text column from CSV cells", () => {
    const f = frameFromCells(["age", "name"], [["30", "Alice"], ["25", "Bob"], ["", "Cara"]]);
    expect(f.columns[0]).toMatchObject({ name: "age", type: "number" });
    expect(f.columns[0].values).toEqual([30, 25, null]);
    expect(f.columns[1]).toMatchObject({ name: "name", type: "string" });
    expect(f.columns[1].values).toEqual(["Alice", "Bob", "Cara"]);
  });

  it("stays numeric through thousands commas, goes text otherwise", () => {
    expect(inferColumn("x", ["1,234", "5,678"]).type).toBe("number");
    expect(inferColumn("x", ["1,234", "5,678"]).values).toEqual([1234, 5678]);
    expect(inferColumn("y", ["1", "n/a", "3"]).type).toBe("string");
    expect(inferColumn("y", ["1", "n/a", "3"]).values).toEqual(["1", "n/a", "3"]);
  });

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
