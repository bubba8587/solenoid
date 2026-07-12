import { describe, it, expect } from "vitest";
import {
  isUncertain, uncertain, asUncertain, uncertainCenter, coerceNumber,
  addUncertain, subUncertain, mulUncertain, divUncertain,
} from "./valueKinds";

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

  it("asUncertain widens a number and passes an uncertain through", () => {
    expect(asUncertain(7)).toEqual({ kind: "uncertain", value: 7, error: 0 });
    const u = uncertain(3, 1);
    expect(asUncertain(u)).toBe(u);
  });

  it("uncertainCenter and coerceNumber collapse to the central estimate", () => {
    expect(uncertainCenter(uncertain(12, 4))).toBe(12);
    expect(uncertainCenter(9)).toBe(9);
    expect(coerceNumber(uncertain(12, 4))).toBe(12); // an error bar degrades in a numeric context
  });
});

describe("error propagation (first-order Gaussian)", () => {
  it("sums add errors in quadrature", () => {
    const r = addUncertain(uncertain(10, 3), uncertain(20, 4));
    expect(r.value).toBe(30);
    expect(r.error).toBeCloseTo(5, 10); // √(3² + 4²) = 5
  });

  it("differences also add errors in quadrature (never subtract them)", () => {
    const r = subUncertain(uncertain(10, 3), uncertain(4, 4));
    expect(r.value).toBe(6);
    expect(r.error).toBeCloseTo(5, 10); // √(3² + 4²) = 5, not |3−4|
  });

  it("products compound RELATIVE errors", () => {
    // z = a·b, (σz/z)² = (σa/a)² + (σb/b)²
    const a = uncertain(10, 1); // 10% relative
    const b = uncertain(20, 4); // 20% relative
    const r = mulUncertain(a, b);
    expect(r.value).toBe(200);
    const relExpected = Math.hypot(1 / 10, 4 / 20); // √(0.1² + 0.2²)
    expect(r.error / 200).toBeCloseTo(relExpected, 10);
  });

  it("quotients compound relative errors like products", () => {
    const a = uncertain(10, 1);
    const b = uncertain(20, 4);
    const r = divUncertain(a, b);
    expect(r.value).toBeCloseTo(0.5, 10);
    const rel = Math.hypot(1 / 10, 4 / 20);
    expect(r.error / 0.5).toBeCloseTo(rel, 10);
  });

  it("a product with a zero-valued operand still has a finite error (no divide-by-zero)", () => {
    const r = mulUncertain(uncertain(0, 2), uncertain(5, 1));
    expect(r.value).toBe(0);
    // d(ab) = √((b·σa)² + (a·σb)²) = √((5·2)² + (0·1)²) = 10
    expect(r.error).toBeCloseTo(10, 10);
    expect(Number.isFinite(r.error)).toBe(true);
  });

  it("mixing a plain number treats it as zero-error", () => {
    const r = addUncertain(uncertain(10, 3), 5);
    expect(r.value).toBe(15);
    expect(r.error).toBeCloseTo(3, 10);
  });
});
