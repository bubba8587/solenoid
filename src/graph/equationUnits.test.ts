// The Equation node derives the unknown's UNIT from the relation (FC A4
// consistency): knowns wired in with units run the numeric engine on base-SI
// magnitudes, and the solved variable comes out tagged with the dimension the
// isolated expression implies. Bare graphs stay bare, byte-identical.
import { describe, it, expect } from "vitest";
import { EquationNode } from "./nodes/equation";
import { fromUnit, isUnitCell, unitLabelOf, isRatio, type UnitCell } from "./unitValue";
import { fcUnitToUnit } from "./unitBridge";
import { parseUnit } from "./dimension";
import { isSolError, type SolError } from "./errorValue";

const cell = (v: number, id: string): UnitCell => {
  const u = fcUnitToUnit(id) ?? parseUnit(id);
  if (!u) throw new Error(`unresolvable unit ${id}`);
  const c = fromUnit(v, u, id);
  if (!isUnitCell(c)) throw new Error("expected a UnitCell");
  return c;
};
// The electrical units by explicit dimension vector (the parser doesn't spell V/A).
const VOLT = { dim: { mass: 1, length: 2, time: -3, current: -1 }, scale: 1 };
const AMP = { dim: { current: 1 }, scale: 1 };

describe("Equation node — units derive through the solve", () => {
  it("d = v · t: solving d from 5 m/s and 10 s gives 50 m", () => {
    const eq = new EquationNode({ expr: "d = v * t" });
    const out = eq.data({ v: [cell(5, "ms1")], t: [cell(10, "s")] });
    const d = out.d as UnitCell;
    expect(isUnitCell(d)).toBe(true);
    expect(d.value).toBe(50);
    expect(unitLabelOf(d)).toBe("m");
  });

  it("d = v · t: solving v from 100 m and 20 s gives 5 m/s", () => {
    const eq = new EquationNode({ expr: "d = v * t" });
    const out = eq.data({ d: [cell(100, "m")], t: [cell(20, "s")] });
    const v = out.v as UnitCell;
    expect(isUnitCell(v)).toBe(true);
    expect(v.value).toBe(5);
    expect(unitLabelOf(v)).toBe("m/s");
  });

  it("knowns pass through with their tags; base-SI runs the math (km known)", () => {
    const eq = new EquationNode({ expr: "d = v * t" });
    // d = 1 km (base 1000 m), t = 200 s → v = 5 m/s
    const out = eq.data({ d: [cell(1, "km")], t: [cell(200, "s")] });
    expect(unitLabelOf(out.v)).toBe("m/s");
    expect((out.v as UnitCell).value).toBe(5);
    // the known's own output keeps its display tag
    expect((out.d as UnitCell).display).toBe("km");
  });

  it("a quadratic through isolation derives too: x² = A (area) → x in metres", () => {
    const eq = new EquationNode({ expr: "x^2 = A" });
    const A = fromUnit(36, parseUnit("m^2")!) as UnitCell;
    const out = eq.data({ A: [A] });
    // both real roots, each tagged length
    const roots = out.x as (UnitCell | number)[];
    expect(Array.isArray(roots)).toBe(true);
    for (const r of roots) {
      expect(isUnitCell(r)).toBe(true);
      expect(unitLabelOf(r)).toBe("m");
    }
    expect((roots as UnitCell[]).map((r) => r.value).sort((a, b) => a - b)).toEqual([-6, 6]);
  });

  it("check mode: commensurable sides compare in base SI (1 km = 1000 m holds)", () => {
    const eq = new EquationNode({ expr: "a = b" });
    const out = eq.data({ a: [cell(1, "km")], b: [cell(1000, "m")] });
    expect(out.holds).toBe(true);
  });

  it("check mode: different dimensions can't hold — #UNIT!", () => {
    const eq = new EquationNode({ expr: "a = b" });
    const out = eq.data({ a: [cell(1, "m")], b: [cell(1, "s")] });
    expect(isSolError(out.holds)).toBe(true);
    expect((out.holds as SolError).code).toBe("#UNIT!");
  });

  it("a bare-number equation stays bare (no unit machinery engaged)", () => {
    const eq = new EquationNode({ expr: "V = I * R" });
    const out = eq.data({ V: [12], I: [2] });
    expect(out.R).toBe(6);
    expect(isUnitCell(out.R)).toBe(false);
  });

  it("Ohm's law with units: R from 12 V and 2 A reads 6 Ω", () => {
    const eq = new EquationNode({ expr: "V = I * R" });
    const V = fromUnit(12, VOLT) as UnitCell;
    const I = fromUnit(2, AMP) as UnitCell;
    const out = eq.data({ V: [V], I: [I] });
    expect(isUnitCell(out.R)).toBe(true);
    expect((out.R as UnitCell).value).toBe(6);
    expect(unitLabelOf(out.R)).toBe("Ω");
  });
});

describe("pure ratio (cancellation) — end to end sanity", () => {
  it("a ratio solved INTO an equation behaves as a plain number", () => {
    // ratio × base quantity re-dimensionalizes naturally elsewhere; here just
    // confirm an equation consumes a ratio as its magnitude.
    const eq = new EquationNode({ expr: "y = r * x" });
    const r = { __unitCell: true, value: 2.5, dim: {}, ratio: true } as unknown as UnitCell;
    const out = eq.data({ r: [r], x: [cell(4, "m")] });
    expect((out.y as UnitCell).value).toBe(10);
    expect(unitLabelOf(out.y)).toBe("m");
    expect(isRatio(out.y)).toBe(false);
  });
});
