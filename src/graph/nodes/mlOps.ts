// The two unsupervised staples, rete-free: k-means (sklearn KMeans / R kmeans) and PCA
// (sklearn PCA / R prcomp). Both take rows × features numbers; the frame cards pick the
// numeric columns and drop rows with a blank.
import { matEigh, matSolve } from "./matrixOps";
import { mulberry32 } from "../monteCarlo";
import { stdNormCDF } from "./mathUtils";

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

// ─── Logistic regression (R glm(binomial) / statsmodels Logit: unregularized MLE by IRLS) ───
export interface LogisticFit {
  /** Intercept first, then one per feature column. */
  coefficients: number[];
  stdErrors: number[];
  z: number[];
  pValues: number[];
  /** Fitted P(y = 1) per row, in input order. */
  probabilities: number[];
  logLikelihood: number;
  iterations: number;
  converged: boolean;
}

/** Iteratively reweighted least squares on [1 | X] against a 0/1 target; Wald standard
 *  errors from the final information matrix. `null` for a degenerate design (a constant
 *  target, no rows, more columns than rows) — perfectly separable data reaches the
 *  iteration cap with huge coefficients and `converged: false`, like glm's warning. */
export function logisticFit(X: readonly (readonly number[])[], y: readonly number[], opts: { maxIter?: number; tol?: number } = {}): LogisticFit | null {
  const n = X.length;
  if (n === 0 || y.length !== n) return null;
  const p = X[0].length + 1;
  if (n <= p) return null;
  if (y.every((v) => v === y[0])) return null;
  const D = X.map((row) => [1, ...row]);
  let beta = new Array<number>(p).fill(0);
  const maxIter = opts.maxIter ?? 100, tol = opts.tol ?? 1e-10;
  const sigmoid = (t: number) => 1 / (1 + Math.exp(-t));
  let converged = false, it = 0;
  let H: number[][] = [];
  for (; it < maxIter; it++) {
    const eta = D.map((row) => row.reduce((s, v, j) => s + v * beta[j], 0));
    const mu = eta.map(sigmoid);
    const w = mu.map((m) => Math.max(m * (1 - m), 1e-12));
    const z = eta.map((e, i) => e + (y[i] - mu[i]) / w[i]);
    H = Array.from({ length: p }, (_, a) => Array.from({ length: p }, (_, b) => D.reduce((s, row, i) => s + w[i] * row[a] * row[b], 0)));
    const g = Array.from({ length: p }, (_, a) => D.reduce((s, row, i) => s + w[i] * row[a] * z[i], 0));
    const next = matSolve(H, g);
    if (!next) return null;
    const delta = Math.max(...next.map((v, j) => Math.abs(v - beta[j])));
    beta = next;
    if (delta < tol) { converged = true; it++; break; }
  }
  const eta = D.map((row) => row.reduce((s, v, j) => s + v * beta[j], 0));
  const mu = eta.map(sigmoid);
  const w = mu.map((m) => Math.max(m * (1 - m), 1e-12));
  H = Array.from({ length: p }, (_, a) => Array.from({ length: p }, (_, b) => D.reduce((s, row, i) => s + w[i] * row[a] * row[b], 0)));
  // diag of H⁻¹ by solving for each unit vector
  const stdErrors = Array.from({ length: p }, (_, j) => {
    const e = new Array<number>(p).fill(0); e[j] = 1;
    const col = matSolve(H, e);
    return col ? Math.sqrt(Math.max(0, col[j])) : NaN;
  });
  const z = beta.map((b, j) => b / stdErrors[j]);
  const pValues = z.map((v) => 2 * (1 - stdNormCDF(Math.abs(v))));
  const logLikelihood = mu.reduce((s, m, i) => s + (y[i] ? Math.log(Math.max(m, 1e-300)) : Math.log(Math.max(1 - m, 1e-300))), 0);
  return { coefficients: beta, stdErrors, z, pValues, probabilities: mu, logLikelihood, iterations: it, converged };
}
