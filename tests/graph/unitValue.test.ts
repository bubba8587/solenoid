// [[D43]]
import { describe, it, expect } from "vitest";
import {
  isUnitCell, dimOf, magnitudeOf, tagDim, fromUnit, unitLabelOf,
  arithmeticCell, compareUnits,
  forAggregateUnits, sameColumnUnit,
  matrixUnitOf, withMatrixUnit, carryMatrixUnit,
  adoptMagnitude, type UnitCell,
} from "../../src/graph/unitValue";
import { parseUnit, isDimensionless, type Unit } from "../../src/graph/dimension";
import { isSolError, solError } from "../../src/graph/errorValue";

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
    const r = arithmeticCell("div", cell(5, "m"), cell(1, "s")) as UnitCell;
    expect(r.value).toBe(5);
    expect(r.dim).toEqual({ length: 1, time: -1 });
    expect(unitLabelOf(r)).toBe("m/s");
  });
  it("km ÷ h normalises to base m/s", () => {
    const r = arithmeticCell("div", cell(2, "km"), cell(1, "h")) as UnitCell;
    // 2000 m / 3600 s
    expect(r.value).toBeCloseTo(2000 / 3600, 9);
    expect(unitLabelOf(r)).toBe("m/s");
  });
  it("mass · accel → N (derived-unit display)", () => {
    const force = arithmeticCell("mul", cell(2, "kg"), cell(3, "m/s^2")) as UnitCell;
    expect(force.value).toBe(6);
    expect(unitLabelOf(force)).toBe("N");
  });
  it("cancellation mints a PURE RATIO: 5 m ÷ 1 m is 5:1, not a re-labelable bare 5", () => {
    // (The dead per-op combinator this test once pinned returned a bare 5 — stale
    // against the live rule: known-dimensionless, so an FC can't re-label it.)
    const r = arithmeticCell("div", cell(5, "m"), cell(1, "m")) as UnitCell;
    expect(isUnitCell(r)).toBe(true);
    expect(r.ratio).toBe(true);
    expect(magnitudeOf(r)).toBe(5);
  });
  it("+ / − require commensurability; km + m works (base-SI add)", () => {
    const r = arithmeticCell("add", cell(1, "km"), cell(500, "m")) as UnitCell;
    expect(r.value).toBe(1500); // 1000 + 500 m
    expect(dimOf(r)).toEqual({ length: 1 });
  });
  it("+ across dimensions → #UNIT!", () => {
    const r = arithmeticCell("add", cell(1, "m"), cell(1, "s"));
    expect(isSolError(r)).toBe(true);
    if (isSolError(r)) expect(r.code).toBe("#UNIT!");
  });
  it("− across dimensions → #UNIT!", () => {
    const r = arithmeticCell("sub", cell(1, "m"), cell(1, "kg"));
    expect(isSolError(r)).toBe(true);
  });
  it("a bare number ADOPTS the dimensioned side's unit (spreadsheet reading)", () => {
    // author decision 2026-07-13: `$5 + 2 = $7` — a dimensionless operand takes the
    // other's dimension (at base-SI scale) + keeps its display id, rather than #UNIT!.
    const r = arithmeticCell("add", cell(5, "m"), 2) as UnitCell;
    expect(isSolError(r)).toBe(false);
    expect(r.value).toBe(7);
    expect(r.dim).toEqual({ length: 1 });
    // (display preservation through the real FC path is covered in unitCoercion.test.ts)
    // symmetric: bare number on the left
    const l = arithmeticCell("sub", 10, cell(3, "m")) as UnitCell;
    expect(l.value).toBe(7);
    expect(l.dim).toEqual({ length: 1 });
  });
  it("power scales the dimension; a dimensioned exponent errors", () => {
    const area = arithmeticCell("pow", cell(3, "m"), 2) as UnitCell;
    expect(area.value).toBe(9);
    expect(area.dim).toEqual({ length: 2 });
    expect(isSolError(arithmeticCell("pow", cell(3, "m"), cell(2, "m")))).toBe(true);
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
    expect(isSolError(arithmeticCell("add", money(5, "usd"), money(5, "eur")))).toBe(true);
    expect((arithmeticCell("add", money(5, "usd"), money(2, "usd")) as UnitCell).value).toBe(7);
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

describe("homogeneous matrix unit (unitGranularity) — one tag on the array, cells stay bare", () => {
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

describe("affine temperatures (review pins)", () => {
  const degC = (v: number) => fromUnit(v, U("degC"), "degC");
  it("two absolutes subtract to a delta in the base unit, never an absolute reading", () => {
    const d = arithmeticCell("sub", degC(25), degC(20));
    expect(isUnitCell(d) && d.display).toBeUndefined();
    expect(magnitudeOf(d as UnitCell)).toBeCloseTo(5, 9); // 5 K
    const f = arithmeticCell("sub", fromUnit(50, U("degF"), "degF"), fromUnit(32, U("degF"), "degF"));
    expect(isUnitCell(f) && f.display).toBeUndefined();
    expect(magnitudeOf(f as UnitCell)).toBeCloseTo(10, 9); // 10 K
  });
  it("an absolute plus a bare delta keeps the reading", () => {
    const r = arithmeticCell("add", degC(20), 5);
    expect(isUnitCell(r) && r.display).toBe("degC");
    expect(magnitudeOf(r as UnitCell)).toBeCloseTo(298.15, 9); // 25 °C
  });
  it("×, ÷ and ^ on an absolute temperature are refused", () => {
    expect(isSolError(arithmeticCell("mul", degC(20), 2))).toBe(true);
    expect(isSolError(arithmeticCell("div", degC(20), 2))).toBe(true);
    expect(isSolError(arithmeticCell("pow", degC(20), 2))).toBe(true);
    expect(isUnitCell(arithmeticCell("mul", fromUnit(20, U("K"), "K"), 2))).toBe(true); // kelvin is linear
  });
  it("a bare number compared with a reading is a reading: 25 °C > 30 is FALSE", () => {
    const r = compareUnits(degC(25), 30) as { l: number; r: number };
    expect(r.l > r.r).toBe(false);
    expect(r.r).toBeCloseTo(303.15, 9);
    const k = compareUnits(fromUnit(5, U("km"), "km"), 3000) as { l: number; r: number };
    expect(k.l > k.r).toBe(false); // a linear unit is unchanged: 3000 km
  });
  it("two readings have no sum, and a reading has no remainder, as in a formula", () => {
    const code = (v: unknown) => (isSolError(v) ? v.code : null);
    expect(code(arithmeticCell("add", degC(20), degC(30)))).toBe("#UNIT!");
    expect(code(arithmeticCell("add", degC(20), fromUnit(50, U("degF"), "degF")))).toBe("#UNIT!");
    expect(code(arithmeticCell("mod", degC(20), 5))).toBe("#UNIT!");
    const warm = arithmeticCell("add", degC(20), fromUnit(5, U("K"), "K")) as UnitCell;
    expect(magnitudeOf(warm)).toBeCloseTo(298.15, 9); // a kelvin cell stays linear
  });
  it("the Arithmetic card refuses two readings added, element-wise too", async () => {
    const { ArithmeticNode } = await import("../../src/graph/nodes/scalar");
    const run = (op: string, a: unknown, b: unknown) =>
      new ArithmeticNode({ op: op as never }).data({ a: [a as never], b: [b as never] }).result;
    expect((run("add", degC(20), degC(30)) as { code?: string }).code).toBe("#UNIT!");
    const pair = run("add", [degC(20), degC(21)], degC(30)) as { code?: string }[];
    expect(pair.map((c) => c.code)).toEqual(["#UNIT!", "#UNIT!"]);
    expect(magnitudeOf(run("sub", degC(30), degC(20)) as UnitCell)).toBeCloseTo(10, 9);
  });
  it("Aggregate follows the formula: a spread is a delta, readings have no sum", async () => {
    const { AggregateNode } = await import("../../src/graph/nodes/list");
    const agg = (op: string, list: unknown[]) => new AggregateNode({ op: op as never }).data({ list: [list as never] }).result;
    const sd = agg("stdev", [degC(20), degC(30)]) as UnitCell;
    expect(sd.display).toBeUndefined();
    expect(magnitudeOf(sd)).toBeCloseTo(Math.SQRT2 * 5, 9); // 7.07 K, never −266 °C
    expect((agg("sum", [degC(20), degC(30)]) as { code?: string }).code).toBe("#UNIT!");
    const avg = agg("avg", [degC(20), degC(30)]) as UnitCell;
    expect(avg.display).toBe("degC");
    expect(magnitudeOf(avg)).toBeCloseTo(298.15, 9); // 25 °C is a reading
    const one = agg("sum", [degC(20), 5]) as UnitCell; // a reading plus a delta
    expect(one.display).toBe("degC");
    expect(magnitudeOf(one)).toBeCloseTo(298.15, 9);
  });
  it("a bare number beside readings is a reading in MIN, MAX, AVERAGE and the spreads", async () => {
    const { AggregateNode } = await import("../../src/graph/nodes/list");
    const agg = (op: string, list: unknown[]) => new AggregateNode({ op: op as never }).data({ list: [list as never] }).result as UnitCell;
    expect(magnitudeOf(agg("min", [degC(25), 20]))).toBeCloseTo(293.15, 9); // 20 °C, not 20 K
    expect(agg("min", [degC(25), 20]).display).toBe("degC");
    expect(magnitudeOf(agg("max", [20, degC(25)]))).toBeCloseTo(298.15, 9);
    expect(magnitudeOf(agg("avg", [degC(20), 30]))).toBeCloseTo(298.15, 9);
    expect(magnitudeOf(agg("median", [degC(20), 30, degC(40)]))).toBeCloseTo(303.15, 9);
    expect(magnitudeOf(agg("stdev", [degC(20), 30]))).toBeCloseTo(Math.SQRT2 * 5, 9);
    const km = agg("min", [fromUnit(5, U("km"), "km"), 3]); // a linear unit adopts its scale only
    expect(magnitudeOf(km)).toBeCloseTo(3000, 9);
  });
});

describe("Math's dimension-preserving ops act on the displayed reading ([[C25]] firstClassUnits)", () => {
  const run = async (op: string, v: unknown) => {
    const { MathFXNode } = await import("../../src/graph/nodes/scalar");
    return new MathFXNode({ op: op as never }).data({ in: [v as never] }).result as UnitCell;
  };
  it("ABS(-5 km) is 5 km, INT(1.7 km) is 1 km, INT(20.5 °C) is 20 °C", async () => {
    const { applyFcUnit, displayMagnitudeOf } = await import("../../src/graph/unitBridge");
    const abs = await run("abs", applyFcUnit(-5, "km"));
    expect(abs.display).toBe("km");
    expect(displayMagnitudeOf(abs)).toBeCloseTo(5, 9);
    const int = await run("int", applyFcUnit(1.7, "km"));
    expect(displayMagnitudeOf(int)).toBeCloseTo(1, 9);
    const t = await run("int", applyFcUnit(20.5, "degC"));
    expect(t.display).toBe("degC");
    expect(displayMagnitudeOf(t)).toBeCloseTo(20, 9);
  });
});

describe("the Arithmetic card's unit path classifies a non-finite result (review pin)", () => {
  it("(-5 km) ^ 0.5 is #DOMAIN!, never a NaN-valued unit cell", async () => {
    const { ArithmeticNode } = await import("../../src/graph/nodes/scalar");
    const { applyFcUnit } = await import("../../src/graph/unitBridge");
    const r = new ArithmeticNode({ op: "pow" }).data({ a: [applyFcUnit(-5, "km") as never], b: [0.5] }).result;
    expect(isSolError(r) && r.code).toBe("#DOMAIN!");
  });
});
