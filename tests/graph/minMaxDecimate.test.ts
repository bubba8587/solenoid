// [[C100]] chartIsAValue
import { describe, expect, it } from "vitest";
import { minMaxDecimate } from "../../src/graph/components/chartCore";

const series = (vs: number[]) => vs.map((v, i) => ({ i, v }));

describe("minMaxDecimate", () => {
  it("leaves a series no denser than four points a bucket alone", () => {
    const s = series([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(minMaxDecimate(s, 2)).toBe(s);
  });

  it("keeps every bucket's lowest and highest point in index order, two per bucket", () => {
    const vs = Array.from({ length: 1000 }, (_, i) => Math.sin(i / 10));
    vs[537] = 50;
    vs[612] = -50;
    const out = minMaxDecimate(series(vs), 20);
    expect(out).toHaveLength(40);
    expect(out.map((p) => p.i)).toEqual([...out.map((p) => p.i)].sort((a, b) => a - b));
    expect(out.some((p) => p.v === 50 && p.i === 537)).toBe(true);
    expect(out.some((p) => p.v === -50 && p.i === 612)).toBe(true);
  });

  it("repeats a flat bucket's point so spacing stays even", () => {
    const out = minMaxDecimate(series(Array(100).fill(3)), 5);
    expect(out).toHaveLength(10);
    expect(out[0]).toBe(out[1]);
  });
});
