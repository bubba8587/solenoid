// [[D4]] noManualList, [[C22]] rowFormulaRefs, [[C80]] blankArgIsExcelBlank
import { describe, it, expect } from "vitest";
import { compileEvaluator } from "../../src/graph/excelFormula";
import { RoundNNode, type RoundNOp } from "../../src/graph/nodes/scalar";

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

describe("the rounding family reads the scaled value at 15 digits, as Excel does", () => {
  const node = (op: RoundNOp, value: number, digits: number) => {
    const n = new RoundNNode({ op });
    return n.data({ value: [value], digits: [digits] }).result;
  };
  it("binary noise never tips a rounding: formula and node agree", () => {
    const cases: [RoundNOp, number, number, number][] = [
      ["round", 1.005, 2, 1.01],
      ["round", 2.675, 2, 2.68],
      ["round", -1.005, 2, -1.01],
      ["roundup", 0.1 + 0.2, 1, 0.3],
      ["rounddown", 0.29, 2, 0.29],
      ["rounddown", 1234.5, -2, 1200],
      ["roundup", -1.21, 1, -1.3],
    ];
    for (const [op, v, d, want] of cases) {
      expect(ev(`${op.toUpperCase()}(${v}, ${d})`)).toBe(want);
      expect(node(op, v, d)).toBe(want);
    }
  });
  it("fractional digits truncate toward zero", () => {
    expect(ev("ROUND(1.26, 1.7)")).toBe(1.3);
    expect(node("round", 1.26, 1.7)).toBe(1.3);
    expect(ev("ROUND(1250, -2.9)")).toBe(1300);
  });
  it("a digits count past the float range leaves the value, or zeroes it", () => {
    expect(ev("ROUND(1.5, 400)")).toBe(1.5);
    expect(ev("ROUND(1.5, -400)")).toBe(0);
    expect(Object.is(ev("ROUND(-0.4, 0)"), 0)).toBe(true);
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
