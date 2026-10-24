// [[D36]], [[C24]], [[D38]]
import { describe, it, expect } from "vitest";
import { isMissing, numberToLogical, coerceLogical, logicalOrTypeError } from "../../src/graph/valueKinds";
import { AggregateNode } from "../../src/graph/nodes/list";
import { solError, isSolError } from "../../src/graph/errorValue";

describe("value-kind predicates", () => {
  it("isMissing only true for null", () => {
    expect(isMissing(null)).toBe(true);
    for (const v of [undefined, 0, NaN, "", false, [], {}]) {
      expect(isMissing(v)).toBe(false);
    }
  });

});

describe("logical ↔ number coercion", () => {
  it("number to logical: non-zero is true", () => {
    expect(numberToLogical(0)).toBe(false);
    expect(numberToLogical(1)).toBe(true);
    expect(numberToLogical(-3.5)).toBe(true);
  });
});

describe("Aggregate's list prep", () => {
  const sum = (list: unknown[]) => new AggregateNode({ op: "sum" }).data({ list: [list] }).result;
  it("sums a plain number list", () => {
    expect(sum([1, 2, 3])).toBe(6);
  });

  it("skips null (missing)", () => {
    expect(sum([1, null, 3, null])).toBe(4);
  });

  it("propagates the first SolError", () => {
    const err = solError("#DIV/0!", "boom");
    expect(sum([1, null, err, 3])).toEqual(err);
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
