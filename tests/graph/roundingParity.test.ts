import { describe, it, expect } from "vitest";
import { compileEvaluator } from "../../src/graph/excelFormula";

// The rounding family is backed "verify" (FAMILY_BACKING) — Excel's half-AWAY-from-zero
// rule differs from JS Math.round's half-UP, and the sign conventions (INT floors toward
// −∞, TRUNC toward 0, EVEN/ODD away from 0) are exact, documented Excel behavior. These
// are unambiguous rules, not golden numbers.
const ev = (e: string) => compileEvaluator(e)!({}) as number;

describe("ROUND is half-away-from-zero (not JS half-up)", () => {
  it("the .5 cases round away from zero on BOTH signs", () => {
    expect(ev("ROUND(2.5, 0)")).toBe(3);
    expect(ev("ROUND(-2.5, 0)")).toBe(-3);   // Math.round(-2.5) = -2 would be the bug
    expect(ev("ROUND(0.5, 0)")).toBe(1);
    expect(ev("ROUND(-0.5, 0)")).toBe(-1);
  });
  it("ROUNDUP is away from zero, ROUNDDOWN toward zero", () => {
    expect(ev("ROUNDUP(1.1, 0)")).toBe(2);
    expect(ev("ROUNDUP(-1.1, 0)")).toBe(-2);
    expect(ev("ROUNDDOWN(1.9, 0)")).toBe(1);
    expect(ev("ROUNDDOWN(-1.9, 0)")).toBe(-1);
  });
});

describe("INT vs TRUNC sign conventions", () => {
  it("INT floors toward −∞; TRUNC truncates toward 0", () => {
    expect(ev("INT(-2.5)")).toBe(-3);
    expect(ev("TRUNC(-2.5)")).toBe(-2);
    expect(ev("INT(2.9)")).toBe(2);
    expect(ev("TRUNC(2.9)")).toBe(2);
    expect(ev("ROUNDDOWN(-3.7, 0)")).toBe(ev("TRUNC(-3.7)")); // same toward-zero rule
  });
});

describe("EVEN / ODD round away from zero to the next even/odd", () => {
  it("both signs, and an already-even/odd value is unchanged", () => {
    expect(ev("EVEN(3)")).toBe(4);
    expect(ev("EVEN(-3)")).toBe(-4);
    expect(ev("EVEN(2)")).toBe(2);
    expect(ev("ODD(2)")).toBe(3);
    expect(ev("ODD(-2)")).toBe(-3);
    expect(ev("ODD(3)")).toBe(3);
  });
});

describe("MROUND / CEILING / FLOOR to a multiple", () => {
  it("MROUND rounds to the nearest multiple (half away from zero)", () => {
    expect(ev("MROUND(10, 3)")).toBe(9);
    expect(ev("MROUND(11, 3)")).toBe(12);
    expect(ev("MROUND(-10, -3)")).toBe(-9);
  });
  it("CEILING rounds up, FLOOR down, to the significance", () => {
    expect(ev("CEILING(2.1, 1)")).toBe(3);
    expect(ev("FLOOR(2.9, 1)")).toBe(2);
    expect(ev("CEILING(2.5, 0.5)")).toBe(2.5);
  });
});
