import { describe, it, expect } from "vitest";
import { collectFinite, extendSafeRange, boundsFromSafeRange } from "./modelFuzz";
import { solError } from "./errorValue";

// Task 2 (Stream D): the model-fuzz "+ Clamp" quick-fix is seeded with the
// observed-safe [min, max] captured during the sweep, instead of inserting an
// unconfigured pass-through Clamp. These cover the pure capture/decision helpers
// (the full sweep needs the DOM area, out of scope for the node test env).

describe("collectFinite", () => {
  it("reads a scalar number", () => {
    expect(collectFinite(3.5)).toEqual([3.5]);
    expect(collectFinite(NaN)).toEqual([]);
    expect(collectFinite(Infinity)).toEqual([]);
    expect(collectFinite("x")).toEqual([]);
    expect(collectFinite(null)).toEqual([]);
  });

  it("flattens a list and a matrix, dropping non-finite + non-number cells", () => {
    expect(collectFinite([1, 2, null, 3])).toEqual([1, 2, 3]);
    expect(collectFinite([1, NaN, solError("#DIV/0!", "x"), 4])).toEqual([1, 4]);
    expect(collectFinite([[1, 2], [3, 4]])).toEqual([1, 2, 3, 4]);
  });
});

describe("extendSafeRange", () => {
  it("accumulates min/max across calls for a node", () => {
    const acc = new Map<string, { min: number; max: number }>();
    extendSafeRange(acc, "n1", [5, 2, 8]);
    extendSafeRange(acc, "n1", [1, 100]);
    expect(acc.get("n1")).toEqual({ min: 1, max: 100 });
  });

  it("keeps nodes independent", () => {
    const acc = new Map<string, { min: number; max: number }>();
    extendSafeRange(acc, "a", [10]);
    extendSafeRange(acc, "b", [-3]);
    expect(acc.get("a")).toEqual({ min: 10, max: 10 });
    expect(acc.get("b")).toEqual({ min: -3, max: -3 });
  });
});

describe("boundsFromSafeRange", () => {
  it("returns bounds for a non-degenerate finite range", () => {
    expect(boundsFromSafeRange({ min: -2, max: 5 })).toEqual({ min: -2, max: 5 });
  });

  it("returns undefined for a single-point range (would pin the value)", () => {
    expect(boundsFromSafeRange({ min: 5, max: 5 })).toBeUndefined();
  });

  it("returns undefined for an empty/uninitialized range or non-finite bounds", () => {
    expect(boundsFromSafeRange(undefined)).toBeUndefined();
    expect(boundsFromSafeRange({ min: Infinity, max: -Infinity })).toBeUndefined();
    expect(boundsFromSafeRange({ min: NaN, max: 1 })).toBeUndefined();
  });
});
