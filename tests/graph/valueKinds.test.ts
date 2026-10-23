// [[D36]], [[C24]], [[D38]]
import { describe, it, expect } from "vitest";
import {
  isMissing, isLogical,
  logicalToNumber, numberToLogical, coerceLogical, logicalOrTypeError,
  forAggregate,
} from "../../src/graph/valueKinds";
import { solError, isSolError } from "../../src/graph/errorValue";

describe("value-kind predicates", () => {
  it("isMissing only true for null", () => {
    expect(isMissing(null)).toBe(true);
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
  });
});

describe("coerceLogical — the one reading of a value as a logical ([[D93]] oneTextReading)", () => {
  it("passes a real boolean through", () => {
    expect(coerceLogical(true)).toBe(true);
    expect(coerceLogical(false)).toBe(false);
  });
  it("reads the text TRUE and FALSE case-insensitively, trimmed", () => {
    expect(coerceLogical("TRUE")).toBe(true);
    expect(coerceLogical(" false ")).toBe(false);
  });
  it("reads a finite number or numeric text by the logical↔number bridge (0 → FALSE, nonzero → TRUE)", () => {
    expect(coerceLogical(0)).toBe(false);
    expect(coerceLogical(-3)).toBe(true);
    expect(coerceLogical("1")).toBe(true);
    expect(coerceLogical(" 0 ")).toBe(false);
    expect(coerceLogical("-2.5")).toBe(true);
  });
  it("reads any other text as NaN; blank stays blank", () => {
    for (const v of ["maybe", "yes", "0x1", NaN, {}]) expect(coerceLogical(v)).toBeNaN();
    expect(coerceLogical("")).toBeNull();
    expect(coerceLogical(null)).toBeNull();
  });
  it("a computation reads that NaN as #TYPE!, naming the value", () => {
    const e = logicalOrTypeError("maybe", "XNOR");
    expect(isSolError(e) && e.code).toBe("#TYPE!");
    expect(isSolError(e) && e.message).toContain('"maybe"');
    expect(logicalOrTypeError("True", "XNOR")).toBe(true);
  });
});
