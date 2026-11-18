// [[C24]] arraySemantics, [[value-semantics#Propagation, by context]], [[value-semantics#Boundaries and bridges]], [[frame-verbs#Type inference]]
import { describe, it, expect } from "vitest";
import { coerceLogical } from "../../src/graph/valueKinds";

describe("coerceLogical — the one reading of a value as a logical ([[C58]] tableInputRawText)", () => {
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
});
