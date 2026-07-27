import { describe, it, expect } from "vitest";
import {
  isUnitCell, dimOf, magnitudeOf, tagDim, fromUnit, unitLabelOf,
  mulUnits, divUnits, addUnits, subUnits, powUnits, compareUnits,
  forAggregateUnits, sameColumnUnit,
  matrixUnitOf, withMatrixUnit, carryMatrixUnit,
  adoptMagnitude, type UnitCell,
} from "./unitValue";
import { parseUnit, isDimensionless, type Unit } from "./dimension";
import { isSolError, solError } from "./errorValue";

const U = (s: string): Unit => {
  const p = parseUnit(s);
  if (!p) throw new Error(`unparseable unit: ${s}`);
  return p;
};
/** Tag `value` expressed in unit `s` (helper: fromUnit + parse). */
const cell = (value: number, s: string) => fromUnit(value, U(s));

describe("tagged cell — construction & storage invariant", () => {
  it("fromUnit stores base-SI magnitude", () => {
    const c = fromUnit(2, U("km")) as UnitCell;
    expect(isUnitCell(c)).toBe(true);
    expect(c.value).toBe(2000); // 2 km → 2000 m base
    expect(c.dim).toEqual({ length: 1 });
  });
  it("affine (°C) offset is consumed into base K on tag", () => {
    const c = fromUnit(20, U("degC")) as UnitCell;
    expect(isUnitCell(c)).toBe(true);
    expect(c.value).toBeCloseTo(293.15, 6);
    expect(c.dim).toEqual({ temperature: 1 });
  });
  it("a dimensionless quantity is never tagged — it stays a bare number", () => {
    expect(fromUnit(5, U("%"))).toBe(0.05); // 5% → 0.05 bare
    expect(tagDim(7, {})).toBe(7);
    expect(isUnitCell(tagDim(7, {}))).toBe(false);
  });
  it("dimOf / magnitudeOf read a cell or a bare number", () => {
    const c = cell(3, "m");
    expect(dimOf(c)).toEqual({ length: 1 });
    expect(magnitudeOf(c)).toBe(3);
    expect(dimOf(9)).toEqual({});
    expect(magnitudeOf(9)).toBe(9);
  });
});

describe("dimensional algebra at the ops", () => {
  it("5 m ÷ 1 s = 5 m/s (the exit-criterion)", () => {
    const r = divUnits(cell(5, "m"), cell(1, "s")) as UnitCell;
    expect(r.value).toBe(5);
    expect(r.dim).toEqual({ length: 1, time: -1 });
    expect(unitLabelOf(r)).toBe("m/s");
  });
  it("km ÷ h normalises to base m/s", () => {
    const r = divUnits(cell(2, "km"), cell(1, "h")) as UnitCell;
    // 2000 m / 3600 s
    expect(r.value).toBeCloseTo(2000 / 3600, 9);
    expect(unitLabelOf(r)).toBe("m/s");
  });
  it("mass · accel → N (derived-unit display)", () => {
    const force = mulUnits(cell(2, "kg"), cell(3, "m/s^2")) as UnitCell;
    expect(force.value).toBe(6);
    expect(unitLabelOf(force)).toBe("N");
  });
  it("cancellation is free: 5 m ÷ 1 m is a bare 5", () => {
    const r = divUnits(cell(5, "m"), cell(1, "m"));
    expect(isUnitCell(r)).toBe(false);
    expect(r).toBe(5);
  });
  it("+ / − require commensurability; km + m works (base-SI add)", () => {
    const r = addUnits(cell(1, "km"), cell(500, "m")) as UnitCell;
    expect(r.value).toBe(1500); // 1000 + 500 m
    expect(dimOf(r)).toEqual({ length: 1 });
  });
  it("+ across dimensions → #UNIT!", () => {
    const r = addUnits(cell(1, "m"), cell(1, "s"));
    expect(isSolError(r)).toBe(true);
    if (isSolError(r)) expect(r.code).toBe("#UNIT!");
  });
  it("− across dimensions → #UNIT!", () => {
    const r = subUnits(cell(1, "m"), cell(1, "kg"));
    expect(isSolError(r)).toBe(true);
  });
  it("a bare number ADOPTS the dimensioned side's unit (spreadsheet reading)", () => {
    // author decision 2026-07-13: `$5 + 2 = $7` — a dimensionless operand takes the
    // other's dimension (at base-SI scale) + keeps its display id, rather than #UNIT!.
    const r = addUnits(cell(5, "m"), 2) as UnitCell;
    expect(isSolError(r)).toBe(false);
    expect(r.value).toBe(7);
    expect(r.dim).toEqual({ length: 1 });
    // (display preservation through the real FC path is covered in unitCoercion.test.ts)
    // symmetric: bare number on the left
    const l = subUnits(10, cell(3, "m")) as UnitCell;
    expect(l.value).toBe(7);
    expect(l.dim).toEqual({ length: 1 });
  });
  it("power scales the dimension; a dimensioned exponent errors", () => {
    const area = powUnits(cell(3, "m"), 2) as UnitCell;
    expect(area.value).toBe(9);
    expect(area.dim).toEqual({ length: 2 });
    expect(isSolError(powUnits(cell(3, "m"), cell(2, "m")))).toBe(true);
  });
  it("compareUnits returns base magnitudes when commensurable, else #UNIT!", () => {
    const ok = compareUnits(cell(1, "km"), cell(900, "m"));
    expect(ok).toEqual({ l: 1000, r: 900 }); // 1 km > 900 m
    expect(isSolError(compareUnits(cell(1, "km"), cell(1, "s")))).toBe(true);
  });
  it("compareUnits lets a dimensionless operand ADOPT the other's unit ($5 vs 1000)", () => {
    // a plain threshold compares against the magnitude, not #UNIT!
    expect(compareUnits(cell(5, "m"), 3)).toEqual({ l: 5, r: 3 });
    expect(compareUnits(1000, cell(5, "m"))).toEqual({ l: 1000, r: 5 });
  });
});

describe("currency: no exchange rate → different codes are incommensurable", () => {
  // Currency cells collapse onto the `currency` axis at scale 1, so a magnitude
  // compare would call $5 == 5€. The display CODE is the real unit identity.
  const money = (value: number, code: string): UnitCell => ({ __unitCell: true, value, dim: { currency: 1 }, display: code });
  it("compareUnits: $5 vs 5€ is #UNIT! (not equal-by-magnitude)", () => {
    expect(isSolError(compareUnits(money(5, "usd"), money(5, "eur")))).toBe(true);
    // same code still compares by magnitude
    expect(compareUnits(money(5, "usd"), money(3, "usd"))).toEqual({ l: 5, r: 3 });
    // an unlabeled currency cell adopts (lenient) — computed currency has no code
    const bare: UnitCell = { __unitCell: true, value: 5, dim: { currency: 1 } };
    expect(compareUnits(money(5, "usd"), bare)).toEqual({ l: 5, r: 5 });
  });
  it("addUnits: $5 + 5€ → #UNIT! (can't combine currencies)", () => {
    expect(isSolError(addUnits(money(5, "usd"), money(5, "eur")))).toBe(true);
    expect((addUnits(money(5, "usd"), money(2, "usd")) as UnitCell).value).toBe(7);
  });
  it("forAggregateUnits: mixed currency codes → #UNIT!", () => {
    const r = forAggregateUnits([money(5, "usd"), money(5, "eur")]);
    expect(r.error && r.error.code).toBe("#UNIT!");
    const same = forAggregateUnits([money(5, "usd"), money(2, "usd")]);
    expect(same.error).toBeUndefined();
  });
});

describe("aggregator prep (step 6)", () => {
  it("sums a same-dimension list, auto-converting km+m to base m", () => {
    const r = forAggregateUnits([cell(1, "km"), cell(500, "m"), cell(500, "m")]);
    expect(r.error).toBeUndefined();
    if (!r.error) {
      expect(r.dim).toEqual({ length: 1 });
      expect(r.nums.reduce((a, b) => a + b, 0)).toBe(2000); // 1000+500+500
    }
  });
  it("skips missing (null) cells", () => {
    const r = forAggregateUnits([cell(1, "m"), null, cell(2, "m")]);
    expect(r.error).toBeUndefined();
    if (!r.error) expect(r.nums).toEqual([1, 2]);
  });
  it("propagates a SolError anywhere in the list", () => {
    const err = solError("#DIV/0!", "x");
    const r = forAggregateUnits([cell(1, "m"), err, cell(2, "m")]);
    expect(r.error).toBe(err);
  });
  it("two different REAL dimensions → #UNIT!", () => {
    const r = forAggregateUnits([cell(1, "m"), cell(1, "s")]);
    expect(r.error && r.error.code).toBe("#UNIT!");
  });
  it("a bare number ADOPTS the list's unit (SUM(5 m, 2 m, 3) keeps length)", () => {
    // author decision 2026-07-13: a dimensionless number adopts the op's unit.
    // (display-carry through the real FC path is covered in unitCoercion.test.ts)
    const r = forAggregateUnits([cell(5, "m"), cell(2, "m"), 3]);
    expect(r.error).toBeUndefined();
    if (!r.error) {
      expect(r.dim).toEqual({ length: 1 });   // the bare 3 adopts length
      expect(r.nums).toEqual([5, 2, 3]);
    }
    // symmetric: a leading bare number still adopts a later real dimension
    const r2 = forAggregateUnits([3, cell(1, "m")]);
    expect(r2.error).toBeUndefined();
    if (!r2.error) expect(r2.dim).toEqual({ length: 1 });
  });

  it("adoption reads the bare number in the list's DISPLAY unit (author 2026-07-16: SUM(5 km, 3) = 8 km)", () => {
    // The bare 3 means 3 km → 3000 base-SI, not 3 meters. A LEADING bare number
    // adopts the km discovered later (the two-pass scan).
    // An FC-authored cell carries its display id — that's what the bare 3 reads in.
    const km = (v: number) => fromUnit(v, U("km"), "km");
    const r = forAggregateUnits([km(5), 3]);
    expect(r.error).toBeUndefined();
    if (!r.error) expect(r.nums).toEqual([5000, 3000]);
    const lead = forAggregateUnits([3, km(5)]);
    expect(lead.error).toBeUndefined();
    if (!lead.error) expect(lead.nums).toEqual([3000, 5000]);
    // A display-LESS cell (no id to read the bare number in) keeps the face value.
    const bare = forAggregateUnits([cell(5, "km"), 3]);
    if (!bare.error) expect(bare.nums).toEqual([5000, 3]);
    expect(adoptMagnitude(3, "km")).toBe(3000);
    expect(adoptMagnitude(3, undefined)).toBe(3); // no display — face value
    expect(adoptMagnitude(3, "definitely-not-a-unit")).toBe(3); // unresolvable — face value
  });
  it("all-bare list stays dimensionless (behavior no-op for today's lists)", () => {
    const r = forAggregateUnits([1, 2, 3]);
    expect(r.error).toBeUndefined();
    if (!r.error) {
      expect(isDimensionless(r.dim)).toBe(true);
      expect(r.nums).toEqual([1, 2, 3]);
    }
  });
});

describe("per-column frame unit", () => {
  it("sameColumnUnit compares dim + display", () => {
    expect(sameColumnUnit({ dim: { length: 1 } }, { dim: { length: 1 } })).toBe(true);
    expect(sameColumnUnit({ dim: { length: 1 }, display: "km" }, { dim: { length: 1 } })).toBe(false);
    expect(sameColumnUnit(undefined, undefined)).toBe(true);
    expect(sameColumnUnit({ dim: { length: 1 } }, undefined)).toBe(false);
  });
});

describe("homogeneous matrix unit (D20) — one tag on the array, cells stay bare", () => {
  it("attaches / reads / carries the tag without touching cells or structural detection", () => {
    const m = [[1, 2], [3, 4]];
    expect(matrixUnitOf(m)).toBeUndefined();
    const tagged = withMatrixUnit(m, { dim: { length: 1 }, display: "km" });
    expect(tagged).toBe(m);                                  // same array
    expect(matrixUnitOf(m)).toMatchObject({ display: "km" });
    expect(Array.isArray(m[0])).toBe(true);                  // structural detection intact
    expect(Object.keys(m)).toEqual(["0", "1"]);              // tag is non-enumerable
    expect(JSON.parse(JSON.stringify(m))).toEqual([[1, 2], [3, 4]]); // invisible to JSON
    // carry onto a fresh array (a unit-preserving op)
    const t = [[1, 3], [2, 4]];
    carryMatrixUnit(t, m);
    expect(matrixUnitOf(t)).toMatchObject({ display: "km" });
  });
  it("a dimensionless / undefined unit clears the tag (a plain matrix stays plain)", () => {
    const m = [[1]];
    withMatrixUnit(m, { dim: { length: 1 }, display: "km" });
    withMatrixUnit(m, undefined);
    expect(matrixUnitOf(m)).toBeUndefined();
    withMatrixUnit(m, { dim: {} });                          // dimensionless → no tag
    expect(matrixUnitOf(m)).toBeUndefined();
  });
});
