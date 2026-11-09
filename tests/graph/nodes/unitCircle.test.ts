// [[C25]]
import { describe, it, expect } from "vitest";
import { UnitCircleNode } from "../../../src/graph/nodes/unitCircle";
import { isSolError } from "../../../src/graph/errorValue";
import type { FrameValue } from "../../../src/graph/frame";

const run = (angle?: unknown) => {
  const n = new UnitCircleNode();
  return (n.data(angle === undefined ? {} : { angle: [angle] }) as { circle: FrameValue }).circle;
};
const row = (f: FrameValue, i = 0) => Object.fromEntries(f.columns.map((c) => [c.name, c.values[i]]));
const code = (v: unknown) => (isSolError(v) ? v.code : v);

describe("Unit Circle", () => {
  it("the card's own angle, 30° by default, with its exact values", () => {
    const r = row(run());
    expect(r.degrees).toBe(30);
    expect(r.radians).toBeCloseTo(Math.PI / 6, 12);
    expect(r.sin).toBe(0.5);
    expect(r.cos).toBeCloseTo(Math.sqrt(3) / 2, 15);
    expect(r.tan).toBeCloseTo(1 / Math.sqrt(3), 12);
    expect([r["sin exact"], r["cos exact"], r["tan exact"]]).toEqual(["1/2", "√3/2", "√3/3"]);
    expect(r.reference).toBe(30);
    expect(r.standard).toBeUndefined();
  });
  it("one row per angle, each with its reference angle", () => {
    const f = run([150, 210, 330, 405, -30]);
    expect(f.columns.find((c) => c.name === "reference")!.values).toEqual([30, 30, 30, 45, 30]);
    expect(f.columns.find((c) => c.name === "sin exact")!.values).toEqual(["1/2", "-1/2", "-1/2", "√2/2", "-1/2"]);
  });
  it("every multiple of 15° is exact, signed by its quadrant", () => {
    const exact = (deg: number) => { const r = row(run(deg)); return [r["sin exact"], r["cos exact"], r["tan exact"]]; };
    expect(exact(15)).toEqual(["(√6-√2)/4", "(√6+√2)/4", "2-√3"]);
    expect(exact(75)).toEqual(["(√6+√2)/4", "(√6-√2)/4", "2+√3"]);
    expect(exact(165)).toEqual(["(√6-√2)/4", "-(√6+√2)/4", "√3-2"]);
    expect(exact(255)).toEqual(["-(√6+√2)/4", "-(√6-√2)/4", "2+√3"]);
    expect(exact(285)).toEqual(["-(√6+√2)/4", "(√6-√2)/4", "-2-√3"]);
    const r = row(run(15));
    expect(r.sin).toBeCloseTo(Math.sin(Math.PI / 12), 15);
    expect(r.tan).toBeCloseTo(2 - Math.sqrt(3), 14);
  });
  it("on an axis: exact zeros, and an undefined function is a blank, its exact form `undefined`", () => {
    const r = row(run(90));
    expect([r.sin, r.cos]).toEqual([1, 0]);
    expect([r.tan, r.sec, r.cot, r.csc]).toEqual([null, null, 0, 1]);
    expect(r["tan exact"]).toBe("undefined");
    expect(row(run(270))["tan exact"]).toBe("undefined");
    const z = row(run(180));
    expect([z.cot, z.csc, z.tan]).toEqual([null, null, 0]);
    for (let deg = 0; deg < 360; deg += 15) expect(Object.values(row(run(deg))).some(isSolError), `${deg}°`).toBe(false);
  });
  it("an angle off the exact table has no exact forms", () => {
    const r = row(run(20));
    expect(r.sin).toBeCloseTo(Math.sin((20 * Math.PI) / 180), 15);
    expect(r["sin exact"]).toBeNull();
  });
  it("[[C25]] an angle's unit converts; another unit is #UNIT!; the columns carry deg and rad", () => {
    const rad = { __unitCell: true as const, value: Math.PI / 2, dim: { angle: 1 }, display: "rad" };
    const f = run(rad);
    expect(row(f).sin).toBe(1);
    expect(f.columns.find((c) => c.name === "degrees")!.unit?.display).toBe("deg");
    expect(f.columns.find((c) => c.name === "radians")!.unit?.display).toBe("rad");
    const m = { __unitCell: true as const, value: 2, dim: { length: 1 }, display: "m" };
    expect(code(row(run(m)).sin)).toBe("#UNIT!");
  });
});
