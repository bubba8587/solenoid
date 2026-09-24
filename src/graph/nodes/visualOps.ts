// [[C17]] shareImpl
import { clamp, iterMin, iterMax } from "./mathUtils";

/** Equal-width bins over `[min, max]` (min < max): the lower edges, and each value's bin by those same edges, the last bin closed. */
export function equalWidthBins(min: number, max: number, bins: number): { edges: number[]; idx: (v: number) => number } {
  const w = (max - min) / bins;
  const edges = Array.from({ length: bins }, (_, i) => min + i * w);
  const idx = (v: number): number => {
    let i = clamp(Math.floor((v - min) / w), 0, bins - 1);
    if (i > 0 && v < edges[i]) i--;
    else if (i < bins - 1 && v >= edges[i + 1]) i++;
    return i;
  };
  return { edges, idx };
}

export function histogram2d(
  xs: readonly unknown[], ys: readonly unknown[], kx: number, ky: number,
): { counts: number[][]; xEdges: number[]; yEdges: number[] } | null {
  const px: number[] = [], py: number[] = [];
  const n = Math.min(xs.length, ys.length);
  for (let i = 0; i < n; i++) {
    const x = xs[i], y = ys[i];
    if (typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)) { px.push(x); py.push(y); }
  }
  if (px.length === 0) return null;
  const axis = (nums: number[], k: number) => {
    const min = iterMin(nums), max = iterMax(nums);
    return min === max ? { edges: [min], idx: () => 0 } : equalWidthBins(min, max, clamp(Math.floor(k) || 1, 1, 100));
  };
  const ax = axis(px, kx), ay = axis(py, ky);
  const counts = Array.from({ length: ax.edges.length }, () => new Array<number>(ay.edges.length).fill(0));
  for (let i = 0; i < px.length; i++) counts[ax.idx(px[i])][ay.idx(py[i])]++;
  return { counts, xEdges: ax.edges, yEdges: ay.edges };
}
