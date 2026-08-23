// The two unsupervised staples, rete-free: k-means (sklearn KMeans / R kmeans) and PCA
// (sklearn PCA / R prcomp). Both take rows × features numbers; the frame cards pick the
// numeric columns and drop rows with a blank.
import { matEigh } from "./matrixOps";
import { mulberry32 } from "../monteCarlo";

export interface KMeansResult { labels: number[]; centers: number[][]; inertia: number; iterations: number }

const sqDist = (a: readonly number[], b: readonly number[]) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return s; };

/** Lloyd's algorithm with k-means++ seeding, `nInit` restarts (seeded, so a recalculation
 *  repeats itself), the lowest-inertia run kept. Labels are 1-based cluster ids. */
export function kmeans(points: readonly (readonly number[])[], k: number, opts: { seed?: number; nInit?: number; maxIter?: number } = {}): KMeansResult | null {
  const n = points.length;
  const kk = Math.round(k);
  if (n === 0 || kk < 1 || kk > n) return null;
  const d = points[0].length;
  const rng = mulberry32(opts.seed ?? 0x5eed);
  const nInit = opts.nInit ?? 10, maxIter = opts.maxIter ?? 300;
  let best: KMeansResult | null = null;
  for (let run = 0; run < nInit; run++) {
    // k-means++
    const centers: number[][] = [[...points[Math.floor(rng() * n)]]];
    const dist = new Array<number>(n).fill(Infinity);
    while (centers.length < kk) {
      const last = centers[centers.length - 1];
      let total = 0;
      for (let i = 0; i < n; i++) { dist[i] = Math.min(dist[i], sqDist(points[i], last)); total += dist[i]; }
      let r = rng() * total, pick = n - 1;
      for (let i = 0; i < n; i++) { r -= dist[i]; if (r <= 0) { pick = i; break; } }
      centers.push([...points[pick]]);
    }
    const labels = new Array<number>(n).fill(0);
    let iter = 0;
    for (; iter < maxIter; iter++) {
      let moved = false;
      for (let i = 0; i < n; i++) {
        let bi = 0, bd = Infinity;
        for (let c = 0; c < kk; c++) { const dd = sqDist(points[i], centers[c]); if (dd < bd) { bd = dd; bi = c; } }
        if (labels[i] !== bi) { labels[i] = bi; moved = true; }
      }
      if (!moved && iter > 0) break;
      const sums = centers.map(() => new Array<number>(d).fill(0)), counts = new Array<number>(kk).fill(0);
      for (let i = 0; i < n; i++) { counts[labels[i]]++; for (let j = 0; j < d; j++) sums[labels[i]][j] += points[i][j]; }
      for (let c = 0; c < kk; c++) {
        if (counts[c] === 0) { centers[c] = [...points[Math.floor(rng() * n)]]; continue; } // an emptied cluster re-seeds
        centers[c] = sums[c].map((s) => s / counts[c]);
      }
    }
    let inertia = 0;
    for (let i = 0; i < n; i++) inertia += sqDist(points[i], centers[labels[i]]);
    if (!best || inertia < best.inertia) best = { labels: labels.map((l) => l + 1), centers: centers.map((c) => [...c]), inertia, iterations: iter };
  }
  // relabel clusters by their first appearance so the same partition always reads the same
  if (best) {
    const seen = new Map<number, number>();
    const remap = best.labels.map((l) => { if (!seen.has(l)) seen.set(l, seen.size + 1); return seen.get(l)!; });
    const centers = new Array<number[]>(best.centers.length);
    for (const [oldL, newL] of seen) centers[newL - 1] = best.centers[oldL - 1];
    best = { ...best, labels: remap, centers };
  }
  return best;
}

export interface PcaResult {
  /** rows × components — the data in the new axes. */
  scores: number[][];
  /** features × components — each column is a principal axis (unit length). */
  loadings: number[][];
  /** Variance along each component (descending). */
  variance: number[];
  /** Share of the total variance per component. */
  ratio: number[];
  means: number[];
  scales: number[];
}

/** Principal components from the covariance (or correlation, when `standardize`) matrix —
 *  centred like sklearn / prcomp; the largest-magnitude loading of each axis is positive. */
export function pca(points: readonly (readonly number[])[], opts: { standardize?: boolean } = {}): PcaResult | null {
  const n = points.length;
  if (n < 2) return null;
  const d = points[0].length;
  const means = Array.from({ length: d }, (_, j) => points.reduce((s, p) => s + p[j], 0) / n);
  const scales = Array.from({ length: d }, (_, j) => {
    if (!opts.standardize) return 1;
    const v = points.reduce((s, p) => s + (p[j] - means[j]) ** 2, 0) / (n - 1);
    return v > 0 ? Math.sqrt(v) : 1;
  });
  const Z = points.map((p) => p.map((v, j) => (v - means[j]) / scales[j]));
  const cov = Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => Z.reduce((s, z) => s + z[i] * z[j], 0) / (n - 1)));
  const eig = matEigh(cov);
  if (!eig) return null;
  const variance = eig.values.map((v) => Math.max(0, v));
  const total = variance.reduce((a, b) => a + b, 0);
  const scores = Z.map((z) => eig.vectors[0].map((_, c) => z.reduce((s, v, j) => s + v * eig.vectors[j][c], 0)));
  return { scores, loadings: eig.vectors, variance, ratio: variance.map((v) => (total > 0 ? v / total : 0)), means, scales };
}
