import { describe, it, expect } from "vitest";
import { toMatrix, toList, toScalar, ShapeError } from "../../../src/graph/nodes/coerce";

describe("toMatrix (widening, never fails)", () => {
  it("promotes a scalar to 1×1", () => {
    expect(toMatrix(5)).toEqual([[5]]);
  });

  it("promotes a list to a 1×N row (CSV orientation)", () => {
    expect(toMatrix([1, 2, 3])).toEqual([[1, 2, 3]]);
  });

  it("passes a matrix through unchanged", () => {
    const m = [[1, 2], [3, 4]];
    expect(toMatrix(m)).toBe(m);
  });

  it("maps null/undefined to null and empty to empty", () => {
    expect(toMatrix(null)).toBeNull();
    expect(toMatrix(undefined)).toBeNull();
    expect(toMatrix([])).toEqual([]);
  });
});

describe("toList (reduce to 1-D)", () => {
  it("wraps a scalar", () => {
    expect(toList(7)).toEqual([7]);
  });

  it("passes a 1-D list through", () => {
    expect(toList([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("flattens a single row", () => {
    expect(toList([[1, 2, 3]])).toEqual([1, 2, 3]);
  });

  it("flattens a single column", () => {
    expect(toList([[1], [2], [3]])).toEqual([1, 2, 3]);
  });

  it("throws ShapeError on a genuine M×N table", () => {
    expect(() => toList([[1, 2], [3, 4]])).toThrow(ShapeError);
    expect(() => toList([[1, 2], [3, 4]])).toThrow(/2×2 table/);
  });

  it("maps null to null and empty to empty", () => {
    expect(toList(null)).toBeNull();
    expect(toList([])).toEqual([]);
  });
});

describe("toScalar (reduce to one value)", () => {
  it("passes a number through", () => {
    expect(toScalar(42)).toBe(42);
  });

  it("unwraps a single-element list or matrix", () => {
    expect(toScalar([9])).toBe(9);
    expect(toScalar([[9]])).toBe(9);
  });

  it("throws ShapeError when more than one element", () => {
    expect(() => toScalar([1, 2])).toThrow(ShapeError);
    expect(() => toScalar([[1, 2], [3, 4]])).toThrow(/got 4/);
  });

  it("maps null to null", () => {
    expect(toScalar(null)).toBeNull();
  });
});
