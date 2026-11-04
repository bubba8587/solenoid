// [[C47]] equationNode, [[C25]] firstClassUnits, [[C24]] arraySemantics, [[equation-solver#Units]]
import { describe, it, expect } from "vitest";
import { EquationNode } from "../../src/graph/nodes/equation";
import { fromUnit, isUnitCell, dimOf, isRatio, type UnitCell } from "../../src/graph/unitValue";
import { fcUnitToUnit } from "../../src/graph/dimension";
import { formatDim } from "../../src/graph/dimension";

const unitLabelOf = (v: unknown) => formatDim(dimOf(v));

const cell = (v: number, id: string): UnitCell => {
  const u = fcUnitToUnit(id);
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
    expect(d.value).toBe(50);
    expect(unitLabelOf(d)).toBe("m");
  });

  it("d = v · t: solving v from 100 m and 20 s gives 5 m/s", () => {
    const eq = new EquationNode({ expr: "d = v * t" });
    const out = eq.data({ d: [cell(100, "m")], t: [cell(20, "s")] });
    const v = out.v as UnitCell;
    expect(v.value).toBe(5);
    expect(unitLabelOf(v)).toBe("m/s");
  });

  it("knowns pass through with their tags; base-SI runs the math (km known)", () => {
    const eq = new EquationNode({ expr: "d = v * t" });
    const out = eq.data({ d: [cell(1, "km")], t: [cell(200, "s")] });
    expect(unitLabelOf(out.v)).toBe("m/s");
    expect((out.v as UnitCell).value).toBe(5);
    expect((out.d as UnitCell).display).toBe("km");
  });

  it("a quadratic through isolation derives too: x² = A (area) → x in meters", () => {
    const eq = new EquationNode({ expr: "x^2 = A" });
    const A = fromUnit(36, fcUnitToUnit("m^2")!) as UnitCell;
    const out = eq.data({ A: [A] });
    const roots = out.x as (UnitCell | number)[];
    for (const r of roots) {
      expect(unitLabelOf(r)).toBe("m");
    }
    expect((roots as UnitCell[]).map((r) => r.value).sort((a, b) => a - b)).toEqual([-6, 6]);
  });

  it("Ohm's law with units: R from 12 V and 2 A reads 6 Ω", () => {
    const eq = new EquationNode({ expr: "V = I * R" });
    const V = fromUnit(12, VOLT) as UnitCell;
    const I = fromUnit(2, AMP) as UnitCell;
    const out = eq.data({ V: [V], I: [I] });
    expect((out.R as UnitCell).value).toBe(6);
    expect(unitLabelOf(out.R)).toBe("Ω");
  });
});

describe("pure ratio (cancellation) — end to end sanity", () => {
  it("a ratio solved INTO an equation behaves as a plain number", () => {
    const eq = new EquationNode({ expr: "y = r * x" });
    const r = { __unitCell: true, value: 2.5, dim: {}, ratio: true } as unknown as UnitCell;
    const out = eq.data({ r: [r], x: [cell(4, "m")] });
    expect((out.y as UnitCell).value).toBe(10);
    expect(unitLabelOf(out.y)).toBe("m");
    expect(isRatio(out.y)).toBe(false);
  });
});
