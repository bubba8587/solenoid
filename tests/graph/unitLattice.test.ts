import { describe, it, expect } from "vitest";
import { type Dim } from "../../src/graph/dimension";
import { dimensionsMultiply, dimensionsAdd, isUniversalDim } from "../../src/graph/unitLattice";
import { arithmeticCell } from "../../src/graph/nodes/scalar";
import { forAggregateUnits, tagDim, dimOf, isUnitCell } from "../../src/graph/unitValue";
import { dimEval } from "../../src/graph/unitDimExpr";
import { parseFormula } from "../../src/graph/excelFormula";
import { isSolError } from "../../src/graph/errorValue";

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

  it("+/− combine when equal OR either is dimensionless; two real dims → #UNIT!", () => {
    for (const a of NAMES) for (const b of NAMES) {
      const combines = dimensionsAdd(DIMS[a], DIMS[b]);
      // combinable iff same dim, or a bare number adopts the other (dimensionless side)
      expect(combines).toBe(a === b || isUniversalDim(DIMS[a]) || isUniversalDim(DIMS[b]));
      for (const op of ["add", "sub"] as const) {
        const r = arithmeticCell(op, cellOf(DIMS[a]), cellOf(DIMS[b]));
        expect(isUnitErr(r)).toBe(!combines);
      }
    }
  });

  it("aggregation reduces when equal OR either is dimensionless; two real dims → #UNIT!", () => {
    for (const a of NAMES) for (const b of NAMES) {
      const prep = forAggregateUnits([cellOf(DIMS[a]), cellOf(DIMS[b])]);
      // a bare number (dimensionless) adopts the other's unit — only two genuinely
      // different real dimensions separate.
      const shouldErr = a !== b && !isUniversalDim(DIMS[a]) && !isUniversalDim(DIMS[b]);
      expect(!!prep.error).toBe(shouldErr);
    }
  });

  it("the dimensionless element is universal for BOTH × and + (a bare number adopts)", () => {
    for (const name of NAMES) {
      const d = DIMS[name];
      // scalar × d always combines
      expect(isUnitErr(arithmeticCell("mul", 2, cellOf(d)))).toBe(false);
      // scalar + d never errors either — the bare 2 adopts d's unit
      expect(isUnitErr(arithmeticCell("add", 2, cellOf(d)))).toBe(false);
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
