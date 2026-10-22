// [[D100]] computedColumnInfersUnit: a computed column takes the unit its formula works out.
import { describe, it, expect } from "vitest";
import { columnUnitFromSpec } from "../../src/graph/unitColumn";
import { isSolError } from "../../src/graph/errorValue";
import { fromUnit } from "../../src/graph/unitValue";
import { fcUnitToUnit } from "../../src/graph/unitBridge";
import { frameSourceToText, type FrameColumn, type FrameValue } from "../../src/graph/frame";
import { ComputedColumnNode, FrameInputNode } from "../../src/graph/nodes/frame";

const unit = (spec: string) => columnUnitFromSpec(spec)!;
const num = (name: string, values: number[], spec?: string): FrameColumn =>
  ({ name, type: "number", values, ...(spec ? { unit: unit(spec) } : {}) });
const frame = (...columns: FrameColumn[]): FrameValue => ({ __frame: true, columns });
const qty = (spec: string, n: number) => fromUnit(n, fcUnitToUnit(spec)!, spec);

const run = (f: FrameValue, expr: string, opts: { name?: string; side?: Record<string, unknown> } = {}) => {
  const n = new ComputedColumnNode({ expr });
  n.stringLiterals.name = opts.name ?? "out";
  const sides = Object.fromEntries(Object.entries(opts.side ?? {}).map(([k, v]) => [k, [v]]));
  n.sideVars = Object.keys(opts.side ?? {});
  const out = n.data({ frame: [f], ...sides } as never).frame as FrameValue;
  const clean = (opts.name ?? "out").replace(/\s*\(.*\)$/, "");
  return out.columns.find((c) => c.name === clean)!;
};
const unitError = (c: FrameColumn) => c.values.length > 0 && c.values.every((v) => isSolError(v) && v.code === "#UNIT!");

describe("a computed column infers its unit from its formula", () => {
  const sales = frame(num("price", [5, 2], "usd"), num("qty", [3, 4]));
  const trips = frame(num("dist", [100, 30], "km"), num("time", [2, 0.5], "hr"));
  const temps = frame(num("lo", [20, 18], "degC"), num("hi", [26, 30], "degC"));

  it("an indeterminate unit drops, and the cells stay in the numbers the columns show", () => {
    const d = frame(num("d", [3, 5], "km"), num("q", [2, 3]));
    for (const expr of ["POWER(@d, 2)", "@d ^ @q"]) {
      const c = run(d, expr);
      expect(c.values).toEqual(expr === "POWER(@d, 2)" ? [9, 25] : [9, 125]);
      expect(c.unit).toBeUndefined();
    }
  });

  it("price times a plain quantity is dollars", () => {
    const c = run(sales, "@price * @qty");
    expect(c.values).toEqual([15, 8]);
    expect(c.unit).toEqual(unit("usd"));
  });

  it("km over h is km/h, in the numbers the columns show", () => {
    const c = run(trips, "@dist / @time");
    expect(c.values).toEqual([50, 60]);
    expect(c.unit?.display).toBe("kmh");
  });

  it("a difference of °C readings is kelvin, a midpoint is °C", () => {
    const d = run(temps, "@hi - @lo");
    expect(d.values).toEqual([6, 12]);
    expect(d.unit).toEqual({ dim: { temperature: 1 } });
    const m = run(temps, "(@lo + @hi) / 2");
    expect(m.values).toEqual([23, 24]);
    expect(m.unit?.display).toBe("degC");
  });

  it("a bare number beside a km column means km", () => {
    const c = run(frame(num("d", [5], "km")), "@d + 1");
    expect(c.values).toEqual([6]);
    expect(c.unit?.display).toBe("km");
  });

  it("km beside mi runs in base SI and answers in m", () => {
    const c = run(frame(num("a", [1], "km"), num("b", [1], "mi")), "@a + @b");
    expect(c.values[0]).toBeCloseTo(1000 + 1609.344, 9);
    expect(c.unit).toEqual({ dim: { length: 1 } });
  });

  it("adding km to h is #UNIT! in every row", () => {
    expect(unitError(run(trips, "@dist + @time"))).toBe(true);
  });

  it("a plain-number column stays plain", () => {
    const c = run(sales, "@qty * 2");
    expect(c.values).toEqual([6, 8]);
    expect(c.unit).toBeUndefined();
  });

  it("a wired value keeps its unit: column times 5 km is km", () => {
    const c = run(frame(num("a", [1, 2])), "@a * k", { side: { k: qty("km", 5) } });
    expect(c.values).toEqual([5, 10]);
    expect(c.unit?.display).toBe("km");
  });

  it("a wired km added to an m column runs in base SI", () => {
    const c = run(frame(num("a", [1, 2], "m")), "@a + k", { side: { k: qty("km", 1) } });
    expect(c.values).toEqual([1001, 1002]);
    expect(c.unit).toEqual({ dim: { length: 1 } });
  });

  it("an authored unit wins: km/h shown in mph", () => {
    const c = run(trips, "@dist / @time", { name: "speed (mph)" });
    expect(c.values[0]).toBeCloseTo(50 / 1.609344, 9);
    expect(c.unit?.display).toBe("mph");
  });

  it("an authored unit on a plain formula tags it as before", () => {
    const c = run(sales, "@qty * 2", { name: "len (km)" });
    expect(c.values).toEqual([6, 8]);
    expect(c.unit?.display).toBe("km");
  });

  it("an authored unit the formula's dimension clashes with is #UNIT!", () => {
    expect(unitError(run(trips, "@dist / @time", { name: "t (hr)" }))).toBe(true);
  });

  it("replacing a united column with a plain formula drops the old unit", () => {
    const c = run(frame(num("d", [5], "km"), num("n", [2])), "@n + 1", { name: "d" });
    expect(c.values).toEqual([3]);
    expect(c.unit).toBeUndefined();
  });

  it("a Frame Input formula column infers its unit too, and a later column reads it", () => {
    const n = new FrameInputNode({
      frameText: frameSourceToText([
        { name: "dist", type: "number", cells: ["100"], unit: "km" },
        { name: "time", type: "number", cells: ["2"], unit: "hr" },
        { name: "speed", type: "number", cells: [], expr: "@dist / @time" },
        { name: "back", type: "number", cells: [], expr: "@speed * @time" },
        { name: "bad", type: "number", cells: [], unit: "hr", expr: "@dist * 2" },
      ]),
    });
    const out = n.data({}).frame as FrameValue;
    const get = (name: string) => out.columns.find((c) => c.name === name)!;
    expect(get("speed").values).toEqual([50]);
    expect(get("speed").unit?.display).toBe("kmh");
    expect(get("back").values[0]).toBeCloseTo(100, 9);
    expect(get("back").unit?.display).toBe("km");
    expect(unitError(get("bad"))).toBe(true);
  });
});
