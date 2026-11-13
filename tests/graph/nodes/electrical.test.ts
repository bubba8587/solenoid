// [[composite-nodes#Packs]], [[C24]]
import { describe, it, expect } from "vitest";
import { ParallelCombineNode } from "../../../src/graph/nodes/electrical";
import { coreFunction } from "../coreFunction";

const nearestESeries = (v: number, series: string) => coreFunction("ESERIESVALUE")!(v, series);
import { solError, isSolError } from "../../../src/graph/errorValue";

describe("ParallelCombineNode", () => {
  const run = (list: (number | null | ReturnType<typeof solError>)[]) =>
    new ParallelCombineNode().data({ list: [list] }).result;

  it("combines equal resistors to value/n", () => {
    expect(run([100, 100])).toBe(50);
    expect(run([4, 4, 2])).toBe(1);
  });

  it("single element passes through, empty is blank", () => {
    expect(run([7])).toBeCloseTo(7, 12);
    expect(run([])).toBe(null);
  });

  it("skips missing (null), propagates a per-cell error", () => {
    expect(run([100, null, 100])).toBe(50);
    const err = solError("#DIV/0!", "boom");
    expect(run([100, err, 100])).toBe(err);
  });

  it("a zero branch short-circuits to 0", () => {
    expect(run([0, 100])).toBe(0);
  });

  it("cancelling reciprocals → #DIV/0!", () => {
    const r = run([1, -1]);
    expect(isSolError(r)).toBe(true);
  });
});

describe("E-series", () => {
  it("published table values (E12/E24 deviate from the pure geometric series)", () => {
    for (const v of [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2]) expect(nearestESeries(v, "E12")).toBe(v);
    expect(nearestESeries(2.7, "E24")).toBe(2.7); // the historic-rounding case (calc gives 2.66)
    // E96 spot-checks against the published table.
    expect(nearestESeries(3.32, "E96")).toBe(3.32);
    expect(nearestESeries(9.76, "E96")).toBe(9.76);
    expect(nearestESeries(3.16, "E48")).toBe(3.16);
  });

  it("nearest snaps across decades and by log distance", () => {
    expect(nearestESeries(4600, "E12")).toBe(4700);
    expect(nearestESeries(510, "E24")).toBe(510);
    expect(nearestESeries(3300, "E96")).toBe(3320);
    expect(nearestESeries(0.5, "E12")).toBe(0.47);
    expect(nearestESeries(9.9, "E12")).toBe(10); // snaps up into the next decade
  });

});

