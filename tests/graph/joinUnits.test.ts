// [[C25]] firstClassUnits: a join reads the right key in the left key's unit.
import { describe, it, expect } from "vitest";
import { joinFrames, joinKeyTransform } from "../../src/graph/frameVerbs";
import { columnUnitFromSpec } from "../../src/graph/unitColumn";
import { isSolError } from "../../src/graph/errorValue";
import { relateFramesToCube, frameRowCount, type FrameColumn, type FrameValue } from "../../src/graph/frame";

const unit = (spec: string) => columnUnitFromSpec(spec)!;
const frame = (...columns: FrameColumn[]): FrameValue => ({ __frame: true, columns });
const thrown = (fn: () => unknown): unknown => { try { fn(); } catch (e) { return e; } return undefined; };

describe("join keys with units", () => {
  it("a km key matches an m key", () => {
    const left = frame({ name: "d", type: "number", values: [5000, 6000], unit: unit("m") }, { name: "tag", type: "string", values: ["a", "b"] });
    const right = frame({ name: "d", type: "number", values: [5, 7], unit: unit("km") }, { name: "v", type: "number", values: [1, 2] });
    const out = joinFrames(left, right, { leftKey: "d", rightKey: "d", how: "left" });
    expect(out.columns.find((c) => c.name === "v")!.values).toEqual([1, null]);
    expect(out.columns[0].unit?.display).toBe("m");
  });

  it("an outer join's right-only key arrives in the left unit", () => {
    const left = frame({ name: "d", type: "number", values: [5000], unit: unit("m") });
    const right = frame({ name: "d", type: "number", values: [5, 7], unit: unit("km") }, { name: "v", type: "number", values: [1, 2] });
    const out = joinFrames(left, right, { leftKey: "d", rightKey: "d", how: "outer" });
    expect(out.columns[0].values).toEqual([5000, 7000]);
  });

  it("conversion noise doesn't block a match: °F reads as °C, m as ft", () => {
    const c = frame({ name: "t", type: "number", values: [20, 100, 0, -40], unit: unit("degC") });
    const f = frame({ name: "t", type: "number", values: [68, 212, 32, -40], unit: unit("degF") }, { name: "v", type: "number", values: [1, 2, 3, 4] });
    expect(joinFrames(c, f, { leftKey: "t", rightKey: "t", how: "left" }).columns[1].values).toEqual([1, 2, 3, 4]);
    const ft = frame({ name: "d", type: "number", values: [1, 10], unit: unit("ft") });
    const m = frame({ name: "d", type: "number", values: [0.3048, 3.048], unit: unit("m") }, { name: "v", type: "number", values: [1, 2] });
    expect(joinFrames(ft, m, { leftKey: "d", rightKey: "d", how: "left" }).columns[1].values).toEqual([1, 2]);
  });

  it("keys measuring different things are #UNIT!", () => {
    const left = frame({ name: "d", type: "number", values: [5], unit: unit("km") });
    const right = frame({ name: "d", type: "number", values: [5], unit: unit("kg") });
    const e = thrown(() => joinFrames(left, right, { leftKey: "d", rightKey: "d", how: "inner" }));
    expect(isSolError(e) && e.code).toBe("#UNIT!");
  });

  it("two currencies are #UNIT!", () => {
    const e = thrown(() => joinKeyTransform(
      { name: "p", type: "number", values: [], unit: unit("$") },
      { name: "p", type: "number", values: [], unit: unit("€") },
    ));
    expect(isSolError(e) && e.code).toBe("#UNIT!");
  });

  it("same unit, or a unit on one side only, needs no transform", () => {
    const km = { name: "d", type: "number" as const, values: [], unit: unit("km") };
    expect(joinKeyTransform(km, km)).toBeNull();
    expect(joinKeyTransform(km, { name: "d", type: "number", values: [] })).toBeNull();
  });

  it("a temperature key carries an offset", () => {
    const t = joinKeyTransform(
      { name: "t", type: "number", values: [], unit: unit("K") },
      { name: "t", type: "number", values: [], unit: unit("degC") },
    );
    expect(t!.scale).toBeCloseTo(1);
    expect(t!.offset).toBeCloseTo(273.15);
  });
});

describe("nest join keys with units", () => {
  it("a km parent key gathers its m child rows", () => {
    const parent = frame({ name: "d", type: "number", values: [5, 6], unit: unit("km") });
    const child = frame({ name: "d", type: "number", values: [5000, 5000, 7000], unit: unit("m") }, { name: "v", type: "number", values: [1, 2, 3] });
    const cube = relateFramesToCube(parent, child, "d", "items")!;
    const nested = cube.columns[1].cells as FrameValue[];
    expect(nested.map((f) => frameRowCount(f))).toEqual([2, 0]);
  });

  it("conversion noise doesn't block a match, as in Join: in and cm, lb and kg, °F and °C", () => {
    const nested = (pu: string, pv: number[], cu: string, cv: number[]) => (relateFramesToCube(
      frame({ name: "k", type: "number", values: pv, unit: unit(pu) }),
      frame({ name: "k", type: "number", values: cv, unit: unit(cu) }), "k", "items")!.columns[1].cells as FrameValue[]).map(frameRowCount);
    expect(nested("in", [1, 12], "cm", [2.54, 30.48])).toEqual([1, 1]);
    expect(nested("lb", [10], "kg", [4.5359237])).toEqual([1]);
    expect(nested("ft", [0.1], "m", [0.03048])).toEqual([1]);
    expect(nested("degF", [68, 451, -459.67], "degC", [20, 232.77777777777777, -273.15])).toEqual([1, 1, 1]);
  });
});

describe("a join keeps its columns' units and formats", () => {
  it("non-key columns from both sides keep their units", () => {
    const left = frame({ name: "id", type: "number", values: [1] }, { name: "w", type: "number", values: [3], unit: unit("kg") });
    const right = frame({ name: "id", type: "number", values: [1] }, { name: "len", type: "number", values: [2], unit: unit("km") });
    const out = joinFrames(left, right, { leftKey: "id", rightKey: "id", how: "inner" });
    expect(out.columns.map((c) => c.unit?.display)).toEqual([undefined, "kg", "km"]);
  });
});
