import { describe, it, expect } from "vitest";
import { ParallelCombineNode, ESeriesNode, AwgNode, nearestESeries, E_SERIES } from "../../../src/graph/nodes/electrical";
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
    expect(E_SERIES.E12).toEqual([1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2]);
    expect(E_SERIES.E24).toContain(2.7); // the historic-rounding case (calc gives 2.66)
    expect(E_SERIES.E48).toHaveLength(48);
    expect(E_SERIES.E96).toHaveLength(96);
    // E96 spot-checks against the published table.
    expect(E_SERIES.E96).toContain(3.32);
    expect(E_SERIES.E96).toContain(9.76);
    expect(E_SERIES.E48).toContain(3.16);
  });

  it("nearest snaps across decades and by log distance", () => {
    expect(nearestESeries(4600, "E12")).toBe(4700);
    expect(nearestESeries(510, "E24")).toBe(510);
    expect(nearestESeries(3300, "E96")).toBe(3320);
    expect(nearestESeries(0.5, "E12")).toBe(0.47);
    expect(nearestESeries(9.9, "E12")).toBe(10); // snaps up into the next decade
  });

  it("node outputs nearest + % error, rejects non-positive values", () => {
    const n = new ESeriesNode({ op: "E12" });
    const r = n.data({ value: [4600] });
    expect(r.nearest).toBe(4700);
    expect(r.errpct).toBeCloseTo(2.174, 2);
    const bad = n.data({ value: [-5] });
    expect(isSolError(bad.nearest)).toBe(true);
  });
});

describe("AwgNode", () => {
  it("AWG 10 matches the published wire tables", () => {
    const r = new AwgNode().data({ gauge: [10] });
    expect(r.diameter as number).toBeCloseTo(2.588, 2);
    expect(r.area as number).toBeCloseTo(5.26, 2);
    expect(r.resistance as number).toBeCloseTo(3.28, 1);
    expect(r.ampacity).toBe(35);
  });

  it("4/0 (gauge −3) and fine wire (30)", () => {
    const big = new AwgNode().data({ gauge: [-3] });
    expect(big.diameter as number).toBeCloseTo(11.684, 2);
    expect(big.ampacity).toBe(230);
    const fine = new AwgNode().data({ gauge: [30] });
    expect(fine.diameter as number).toBeCloseTo(0.2546, 3);
    expect(fine.ampacity).toBe(null); // NEC doesn't list magnet-wire sizes
  });

  it("out-of-range gauge → #DOMAIN!", () => {
    const r = new AwgNode().data({ gauge: [50] });
    expect(isSolError(r.diameter)).toBe(true);
  });
});
