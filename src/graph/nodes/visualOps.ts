import { clamp, iterMin, iterMax } from "./mathUtils";

// Rete-free kernels shared by the visual NODES (visual.ts) and their FORMULA
// registrations (implReteFree): the formula path loads these without pulling in rete
// or the socket lattice, exactly like textOps.ts / statsOps.ts.

/** 2-D histogram of paired (x, y) samples over kx×ky equal-width bins (numpy
 *  histogram2d): pairs are taken by index and a pair is skipped when either side is
 *  non-finite; each axis clamps to 1..100 bins and collapses to one bin when its values
 *  are all equal (the histogramBins single-spike rule). `counts[i][j]` tallies x-bin i,
 *  y-bin j; `xEdges` / `yEdges` are the bins' lower edges. Null when no finite pair survives. */
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
  const axis = (nums: number[], k: number): { edges: number[]; idx: (v: number) => number } => {
    const bins = clamp(Math.floor(k) || 1, 1, 100);
    const min = iterMin(nums), max = iterMax(nums);
    if (min === max) return { edges: [min], idx: () => 0 };
    const w = (max - min) / bins;
    const edges = Array.from({ length: bins }, (_, i) => min + i * w); // lower edges
    return { edges, idx: (v: number) => clamp(Math.floor((v - min) / w), 0, bins - 1) };
  };
  const ax = axis(px, kx), ay = axis(py, ky);
  const counts = Array.from({ length: ax.edges.length }, () => new Array<number>(ay.edges.length).fill(0));
  for (let i = 0; i < px.length; i++) counts[ax.idx(px[i])][ay.idx(py[i])]++;
  return { counts, xEdges: ax.edges, yEdges: ay.edges };
}

/** The bordered grid a Heatmap / Surface reads (row 0 = x lower edges, col 0 = y lower
 *  edges, interior[y][x] = counts[x][y]), shared by the node and the HISTOGRAM2D formula
 *  so they can't disagree. Null passes through from `histogram2d`. */
export function histogram2dGrid(
  xs: readonly unknown[], ys: readonly unknown[], kx: number, ky: number,
): (number | null)[][] | null {
  const h = histogram2d(xs, ys, kx, ky);
  if (!h) return null;
  const grid: (number | null)[][] = [[null, ...h.xEdges]];
  for (let j = 0; j < h.yEdges.length; j++) grid.push([h.yEdges[j], ...h.counts.map((col) => col[j])]);
  return grid;
}
