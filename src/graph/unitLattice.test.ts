import { describe, it, expect } from "vitest";
import { type Dim } from "./dimension";
import { dimensionsMultiply, dimensionsAdd, isUniversalDim } from "./unitLattice";
import { arithmeticCell } from "./nodes/scalar";
import { forAggregateUnits, tagDim, dimOf, isUnitCell } from "./unitValue";
import { dimEval } from "./unitDimExpr";
import { parseFormula } from "./excelFormula";
import { isSolError } from "./errorValue";

// A representative cross-section of the dimension lattice: the universal
// (dimensionless), four base dims, and one derived (speed = length/time).
const DIMS: Record<string, Dim> = {
  scalar: {},
  length: { length: 1 },
  time: { time: 1 },
  mass: { mass: 1 },
  currency: { currency: 1 },
  speed: { length: 1, time: -1 },
};
const NAMES = Object.keys(DIMS);
const cellOf = (dim: Dim) => (isUniversalDim(dim) ? 2 : tagDim(2, dim));
const isUnitErr = (v: unknown) => isSolError(v) && (v as { code: string }).code === "#UNIT!";

describe("unit lattice — full sweep of the dimensional separation contract (step 7)", () => {
  it("×/÷ ALWAYS combine (dimensional flow): never a #UNIT!", () => {
    for (const a of NAMES) for (const b of NAMES) {
      expect(dimensionsMultiply(DIMS[a], DIMS[b])).toBe(true);
      for (const op of ["mul", "div"] as const) {
        const r = arithmeticCell(op, cellOf(DIMS[a]), cellOf(DIMS[b]));
        expect(isUnitErr(r)).toBe(false);
      }
    }
  });

  it("+/− separate: same dimension flows, different is #UNIT!", () => {
    for (const a of NAMES) for (const b of NAMES) {
      const same = dimensionsAdd(DIMS[a], DIMS[b]);
      expect(same).toBe(a === b);
      for (const op of ["add", "sub"] as const) {
        const r = arithmeticCell(op, cellOf(DIMS[a]), cellOf(DIMS[b]));
        expect(isUnitErr(r)).toBe(!same);
      }
    }
  });

  it("aggregation separates: a same-dim list reduces, a mixed-dim list is #UNIT!", () => {
    for (const a of NAMES) for (const b of NAMES) {
      const prep = forAggregateUnits([cellOf(DIMS[a]), cellOf(DIMS[b])]);
      if (a === b) expect(prep.error).toBeUndefined();
      else expect(prep.error && (prep.error as { code: string }).code).toBe("#UNIT!");
    }
  });

  it("the dimensionless element is universal for × and separated for +", () => {
    for (const name of NAMES) {
      const d = DIMS[name];
      // scalar × d always combines
      expect(isUnitErr(arithmeticCell("mul", 2, cellOf(d)))).toBe(false);
      // scalar + d is a #UNIT! unless d is itself dimensionless
      const add = arithmeticCell("add", 2, cellOf(d));
      expect(isUnitErr(add)).toBe(!isUniversalDim(d));
    }
  });

  it("dimEval mirrors the algebra: * combines, + separates, / derives", () => {
    const env = { d: DIMS.length, t: DIMS.time };
    expect(dimOf(tagDim(1, dimEval(parseFormula("d / t")!, env) as Dim))).toEqual(DIMS.speed);
    expect(isUnitErr(dimEval(parseFormula("d + t")!, env))).toBe(true);
    const prod = dimEval(parseFormula("d * t")!, env);
    expect(prod).toEqual({ length: 1, time: 1 });
  });

  it("the algebra is closed: every ×/÷ result is a valid tagged cell or bare number", () => {
    for (const a of NAMES) for (const b of NAMES) {
      const r = arithmeticCell("div", cellOf(DIMS[a]), cellOf(DIMS[b]));
      expect(isSolError(r) || typeof r === "number" || isUnitCell(r)).toBe(true);
    }
  });
});
