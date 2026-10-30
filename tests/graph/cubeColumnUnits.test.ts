// [[C25]] firstClassUnits: a Cube's computed column takes the unit its formula works out, carried on its cells.
import { describe, it, expect } from "vitest";
import { isSolError } from "../../src/graph/errorValue";
import { fromUnit, isUnitCell, type UnitCell } from "../../src/graph/unitValue";
import { displayMagnitudeOf } from "../../src/graph/unitBridge";
import { fcUnitToUnit } from "../../src/graph/dimension";
import { cubeFromColumns, type CubeCell, type CubeValue } from "../../src/graph/frame";
import { ComputedColumnNode } from "../../src/graph/nodes/frame";

const qty = (spec: string, n: number) => fromUnit(n, fcUnitToUnit(spec)!, spec);
const col = (name: string, values: number[], spec?: string) =>
  ({ name, cells: values.map((v) => (spec ? qty(spec, v) : v)) as CubeCell[] });
const cube = (...columns: { name: string; cells: CubeCell[] }[]): CubeValue => cubeFromColumns(columns);

const run = (c: CubeValue, expr: string, opts: { name?: string; side?: Record<string, unknown> } = {}) => {
  const n = new ComputedColumnNode({ expr });
  n.stringLiterals.name = opts.name ?? "out";
  const sides = Object.fromEntries(Object.entries(opts.side ?? {}).map(([k, v]) => [k, [v]]));
  n.sideVars = Object.keys(opts.side ?? {});
  const out = n.data({ frame: [c], ...sides } as never).frame as CubeValue;
  const clean = (opts.name ?? "out").replace(/\s*\(.*\)$/, "");
  return out.columns.find((k) => k.name === clean)!.cells;
};
const shown = (cells: CubeCell[]): unknown[] =>
  cells.map((c) => (isUnitCell(c) ? displayMagnitudeOf(c) : Array.isArray(c) ? shown(c) : c));
const displays = (cells: CubeCell[]) => cells.map((c) => (c as UnitCell).display);
const dims = (cells: CubeCell[]) => cells.map((c) => (c as UnitCell).dim);
const unitError = (cells: CubeCell[]) => cells.length > 0 && cells.every((v) => isSolError(v) && v.code === "#UNIT!");

describe("a Cube's computed column infers its unit from its formula", () => {
  const sales = cube(col("price", [5, 2], "usd"), col("qty", [3, 4]));
  const trips = cube(col("dist", [100, 30], "km"), col("time", [2, 0.5], "hr"));
  const temps = cube(col("lo", [20, 18], "degC"), col("hi", [26, 30], "degC"));

  it("price times a plain quantity is dollars", () => {
    const c = run(sales, "@price * @qty");
    expect(shown(c)).toEqual([15, 8]);
    expect(displays(c)).toEqual(["usd", "usd"]);
  });

  it("km over h is km/h, in the numbers the cells show", () => {
    const c = run(trips, "@dist / @time");
    expect(shown(c)).toEqual([50, 60]);
    expect(displays(c)).toEqual(["kmh", "kmh"]);
  });

  it("a difference of °C readings is kelvin, a midpoint is °C, a sum is #UNIT!", () => {
    const d = run(temps, "@hi - @lo");
    expect(shown(d)).toEqual([6, 12]);
    expect(dims(d)).toEqual([{ temperature: 1 }, { temperature: 1 }]);
    const m = run(temps, "(@lo + @hi) / 2");
    expect(shown(m)).toEqual([23, 24]);
    expect(displays(m)).toEqual(["degC", "degC"]);
    expect(unitError(run(temps, "@lo + @hi"))).toBe(true);
  });

  it("adding km to h is #UNIT! in every row", () => {
    expect(unitError(run(trips, "@dist + @time"))).toBe(true);
  });

  it("a plain-number column stays plain", () => {
    expect(run(sales, "@qty * 2")).toEqual([6, 8]);
  });

  it("a column whose cells mix km and mi reads in base SI and answers in m", () => {
    const c = run(cube({ name: "d", cells: [qty("km", 1), qty("mi", 1)] }), "@d * 2");
    expect((c[0] as UnitCell).value).toBeCloseTo(2000, 9);
    expect((c[1] as UnitCell).value).toBeCloseTo(2 * 1609.344, 9);
    expect(dims(c)).toEqual([{ length: 1 }, { length: 1 }]);
  });

  it("a column whose cells mix two dimensions is #UNIT! when a formula reads it", () => {
    const mixed = cube({ name: "d", cells: [qty("km", 1), qty("hr", 1)] }, col("n", [1, 2]));
    expect(unitError(run(mixed, "@d * 2"))).toBe(true);
    expect(run(mixed, "@n + 1")).toEqual([2, 3]);
  });

  it("a column of km lists keeps km: per item, and summed", () => {
    const legs = cube({ name: "legs", cells: [[qty("km", 1), qty("km", 2)], [qty("km", 5)]] });
    const doubled = run(legs, "@legs * 2");
    expect(shown(doubled)).toEqual([[2, 4], 10]);
    expect((doubled[0] as UnitCell[]).map((c) => c.display)).toEqual(["km", "km"]);
    const total = run(legs, "SUM(@legs)");
    expect(shown(total)).toEqual([3, 5]);
    expect(displays(total)).toEqual(["km", "km"]);
  });

  it("a wired value keeps its unit: column times 5 km is km", () => {
    const c = run(cube(col("a", [1, 2])), "@a * k", { side: { k: qty("km", 5) } });
    expect(shown(c)).toEqual([5, 10]);
    expect(displays(c)).toEqual(["km", "km"]);
  });

  it("an authored unit wins: km/h shown in mph", () => {
    const c = run(trips, "@dist / @time", { name: "speed (mph)" });
    expect(shown(c)[0]).toBeCloseTo(50 / 1.609344, 9);
    expect(displays(c)).toEqual(["mph", "mph"]);
  });

  it("an authored unit on a plain formula tags it as before", () => {
    const c = run(sales, "@qty * 2", { name: "len (km)" });
    expect(shown(c)).toEqual([6, 8]);
    expect(displays(c)).toEqual(["km", "km"]);
  });

  it("an authored unit the formula's dimension clashes with is #UNIT!", () => {
    expect(unitError(run(trips, "@dist / @time", { name: "t (hr)" }))).toBe(true);
  });

  it("replacing a united column with a plain formula drops the old unit", () => {
    expect(run(cube(col("d", [5], "km"), col("n", [2])), "@n + 1", { name: "d" })).toEqual([3]);
  });
});
