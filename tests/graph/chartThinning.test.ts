// [[C100]] chartIsAValue
import { describe, expect, it } from "vitest";
import { minMaxDecimate, envelopeRows, thinXY, figurePoints } from "../../src/graph/components/chartCore";

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

const walk = (n: number, seed = 7) => {
  let s = seed, v = 0;
  return Array.from({ length: n }, () => { s = (s * 16807) % 2147483647; v += (s / 2147483647) - 0.5; return v; });
};

describe("envelopeRows", () => {
  it("leaves series no denser than four rows per series a bucket alone", () => {
    expect(envelopeRows([walk(80), walk(80, 3)], 80, 10)).toBeNull();
  });

  it("keeps each series' lowest and highest row in every bucket, the same count of distinct rows per bucket", () => {
    const a = walk(5000), b: (number | null)[] = walk(5000, 3);
    for (let r = 1000; r < 1400; r++) b[r] = null;
    const buckets = 50;
    const rows = envelopeRows([a, b], 5000, buckets)!;
    expect(rows).toHaveLength(buckets * 4);
    for (let k = 0; k < buckets; k++) {
      const got = rows.slice(k * 4, k * 4 + 4);
      expect(new Set(got).size).toBe(4);
      expect(got).toEqual([...got].sort((x, y) => x - y));
      const lo = Math.floor((k * 5000) / buckets), hi = Math.floor(((k + 1) * 5000) / buckets);
      for (const vals of [a, b]) {
        const span = vals.slice(lo, hi).filter((v): v is number => v !== null);
        if (!span.length) { expect(got.some((r) => vals[r] === null)).toBe(true); continue; }
        expect(got.map((r) => vals[r])).toContain(Math.min(...span));
        expect(got.map((r) => vals[r])).toContain(Math.max(...span));
      }
    }
  });
});

describe("thinXY", () => {
  const px = (x: number) => x / 10, py = (y: number) => y * 4;
  const pts = (ys: number[], xs?: number[]) => ys.map((y, i) => ({ x: xs ? xs[i] : i, y }));
  const columns = (rows: { x: number; y: number }[]) => {
    const m = new Map<number, number[]>();
    for (const p of rows) { const c = Math.floor(px(p.x)); m.set(c, [...(m.get(c) ?? []), p.y]); }
    return [...m].map(([c, ys]) => [c, ys[0], Math.min(...ys), Math.max(...ys), ys[ys.length - 1]]);
  };

  it("keeps a line's first, lowest, highest and last point in each pixel column, so it draws the same strokes", () => {
    const rows = pts(walk(20000));
    const out = thinXY(rows, px, py, "line");
    expect(out.length).toBeLessThanOrEqual(4 * 2000);
    expect(columns(out)).toEqual(columns(rows));
    expect(out.map((p) => p.x)).toEqual([...out.map((p) => p.x)].sort((a, b) => a - b));
  });

  it("thins a line whose x turns back by consecutive pixel cells, keeping each streak's ends", () => {
    const xs = Array.from({ length: 4000 }, (_, i) => 100 * Math.sin(i / 300));
    const rows = pts(walk(4000), xs);
    const out = thinXY(rows, px, py, "line");
    const cells = (rs: { x: number; y: number }[]) => rs.map((p) => `${Math.floor(px(p.x))},${Math.floor(py(p.y))}`)
      .filter((c, i, a) => i === 0 || c !== a[i - 1]);
    expect(out.length).toBeLessThan(rows.length);
    expect(cells(out)).toEqual(cells(rows));
  });

  it("keeps the topmost dot in each pixel and covers exactly the same pixels", () => {
    const rows = pts(walk(10000).map((v) => v * 0.2), walk(10000, 5).map((v) => v * 30));
    const out = thinXY(rows, px, py, "dots");
    const cells = (rs: { x: number; y: number }[]) => new Set(rs.map((p) => `${Math.floor(px(p.x))},${Math.floor(py(p.y))}`));
    expect(out.length).toBeLessThan(rows.length);
    expect(cells(out)).toEqual(cells(rows));
    expect(out[out.length - 1]).toBe(rows[rows.length - 1]);
  });
});

describe("figurePoints", () => {
  it("counts what a figure holds, whichever shape carries it", () => {
    const base = { __chart: true as const, op: "line" as const, options: {} };
    expect(figurePoints({ ...base, values: [1, 2, 3] })).toBe(3);
    expect(figurePoints({ ...base, values: 1, series: [{ name: "a", values: [1, 2] }, { name: "b", values: [3] }] })).toBe(3);
    expect(figurePoints({ ...base, op: "xyline", values: null, payload: { kind: "xy", names: {}, series: [{ name: "", line: "solid", points: [{ x: 1, y: 1 }, null] }] } } as never)).toBe(2);
  });
});
