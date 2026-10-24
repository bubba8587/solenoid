// [[C24]], [[D51]]
import { describe, it, expect } from "vitest";
import { isUncertain, uncertain, coerceNumber } from "../../src/graph/valueKinds";

describe("UncertainNumber kind", () => {
  it("builds a tagged shape and normalizes the error to non-negative", () => {
    const u = uncertain(10, -2);
    expect(u).toEqual({ kind: "uncertain", value: 10, error: 2 });
    expect(isUncertain(u)).toBe(true);
  });

  it("isUncertain rejects plain values and lookalike objects", () => {
    expect(isUncertain(10)).toBe(false);
    expect(isUncertain(null)).toBe(false);
    expect(isUncertain("10 ± 2")).toBe(false);
    expect(isUncertain([10, 2])).toBe(false); // a complex tuple / 2-element list
    expect(isUncertain({ value: 10, error: 2 })).toBe(false); // no brand
    expect(isUncertain({ kind: "uncertain", value: 10 })).toBe(false); // missing error
  });

  it("carries optional samples without breaking the predicate", () => {
    const u = uncertain(5, 1, [4, 5, 6]);
    expect(isUncertain(u)).toBe(true);
    expect(u.samples).toEqual([4, 5, 6]);
  });

  it("coerceNumber collapses to the central estimate", () => {
    expect(coerceNumber(uncertain(12, 4))).toBe(12); // an error bar degrades in a numeric context
  });
});
