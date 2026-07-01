import { describe, it, expect } from "vitest";
import {
  MISSING, isMissing, isLogical,
  logicalToNumber, numberToLogical, coerceLogical,
  kleeneNot, kleeneOr, kleeneAnd,
  forAggregate,
} from "./valueKinds";
import { solError, isSolError } from "./errorValue";

describe("value-kind predicates", () => {
  it("isMissing only true for null", () => {
    expect(isMissing(null)).toBe(true);
    expect(MISSING).toBe(null);
    for (const v of [undefined, 0, NaN, "", false, [], {}]) {
      expect(isMissing(v)).toBe(false);
    }
  });

  it("isLogical only true for booleans", () => {
    expect(isLogical(true)).toBe(true);
    expect(isLogical(false)).toBe(true);
    for (const v of [0, 1, null, "true", NaN]) expect(isLogical(v)).toBe(false);
  });
});

describe("logical ↔ number coercion", () => {
  it("logical to 1/0", () => {
    expect(logicalToNumber(true)).toBe(1);
    expect(logicalToNumber(false)).toBe(0);
  });
  it("number to logical: non-zero is true", () => {
    expect(numberToLogical(0)).toBe(false);
    expect(numberToLogical(1)).toBe(true);
    expect(numberToLogical(-3.5)).toBe(true);
  });
});

describe("Kleene three-valued logic", () => {
  // Truth tables verified against ANSI SQL / Polars / pandas pd.NA.
  it("NOT", () => {
    expect(kleeneNot(true)).toBe(false);
    expect(kleeneNot(false)).toBe(true);
    expect(kleeneNot(null)).toBe(null);
  });

  it("OR — T if any T, else N if any N, else F", () => {
    expect(kleeneOr(true, false)).toBe(true);
    expect(kleeneOr(true, null)).toBe(true);   // T wins
    expect(kleeneOr(null, true)).toBe(true);
    expect(kleeneOr(false, null)).toBe(null);  // could be either
    expect(kleeneOr(null, false)).toBe(null);
    expect(kleeneOr(null, null)).toBe(null);
    expect(kleeneOr(false, false)).toBe(false);
  });

  it("AND — F if any F, else N if any N, else T", () => {
    expect(kleeneAnd(true, true)).toBe(true);
    expect(kleeneAnd(false, null)).toBe(false); // F wins
    expect(kleeneAnd(null, false)).toBe(false);
    expect(kleeneAnd(true, null)).toBe(null);   // could be either
    expect(kleeneAnd(null, true)).toBe(null);
    expect(kleeneAnd(null, null)).toBe(null);
    expect(kleeneAnd(true, false)).toBe(false);
  });
});

describe("forAggregate", () => {
  it("passes plain number lists through unchanged (NaN preserved)", () => {
    const r = forAggregate([1, 2, 3]);
    expect(r.error).toBeUndefined();
    expect((r as { nums: number[] }).nums).toEqual([1, 2, 3]);
    // NaN is NOT stripped — today's behavior is preserved until producers emit null.
    expect((forAggregate([1, NaN, 3]) as { nums: number[] }).nums).toEqual([1, NaN, 3]);
  });

  it("skips null (missing)", () => {
    expect((forAggregate([1, null, 3, null]) as { nums: number[] }).nums).toEqual([1, 3]);
    expect((forAggregate([null, null]) as { nums: number[] }).nums).toEqual([]);
  });

  it("propagates the first SolError", () => {
    const err = solError("#DIV/0!", "boom");
    const r = forAggregate([1, null, err, 3]);
    expect(r.error).toBe(err);
    expect(isSolError(r.error)).toBe(true);
  });
});

describe("coerceLogical — the shared liberal text/number → logical parse", () => {
  it("passes a real boolean through", () => {
    expect(coerceLogical(true)).toBe(true);
    expect(coerceLogical(false)).toBe(false);
  });
  it("parses TRUE/FALSE text case-insensitively, trimmed", () => {
    expect(coerceLogical("TRUE")).toBe(true);
    expect(coerceLogical(" false ")).toBe(false);
  });
  it("follows the logical↔number bridge (0 → FALSE, nonzero → TRUE), incl. numeric strings", () => {
    expect(coerceLogical(0)).toBe(false);
    expect(coerceLogical(-3)).toBe(true);
    expect(coerceLogical("1")).toBe(true);
    expect(coerceLogical("0")).toBe(false);
  });
  it("returns null when it can't be read as a logical", () => {
    expect(coerceLogical("maybe")).toBeNull();
    expect(coerceLogical("")).toBeNull();
    expect(coerceLogical(NaN)).toBeNull();
    expect(coerceLogical({})).toBeNull();
  });
});
