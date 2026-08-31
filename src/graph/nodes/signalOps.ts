// Signal smoothing + peak finding, rete-free (the Smooth and Find Peaks cards and the
// SAVGOL / LOWESS / GAUSSIANSMOOTH / FINDPEAKS formulas). References: scipy.signal
// savgol_filter (mode = interp), scipy.ndimage gaussian_filter1d (reflect, truncate 4),
// Cleveland's LOWESS (tricube, local linear, 3 bisquare iterations — statsmodels / R),
// scipy.signal.find_peaks (height / distance / prominence).
import { isSolError, type SolError } from "../errorValue";
import { matSolve } from "./matrixOps";

export type Cell = number | null | SolError;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Weighted least-squares polynomial fit through (x, y, w); returns the coefficients
 *  a0..ap, or null when the system is singular / under-determined. */
function polyFitW(xs: readonly number[], ys: readonly number[], ws: readonly number[], degree: number): number[] | null {
  const p = degree + 1;
  if (xs.length < p) return null;
  const A: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const b = new Array<number>(p).fill(0);
  for (let k = 0; k < xs.length; k++) {
    const w = ws[k];
    if (w === 0) continue;
    const pow: number[] = [1];
    for (let j = 1; j < 2 * p - 1; j++) pow.push(pow[j - 1] * xs[k]);
    for (let i = 0; i < p; i++) {
      b[i] += w * pow[i] * ys[k];
      for (let j = 0; j < p; j++) A[i][j] += w * pow[i + j];
    }
  }
  return matSolve(A, b);
}

/** Savitzky–Golay: at each position, a degree-`order` polynomial least-squares fit over a
 *  `window` (odd) of neighbours, evaluated there. Edges use the nearest full window
 *  evaluated off-centre (scipy's mode = "interp"). Blank / error cells are left out of the
 *  fits and stay blank in the output. */
export function savgol(values: readonly Cell[], window: number, order: number): Cell[] {
  const n = values.length;
  const m = Math.max(1, Math.floor(window));
  if (m % 2 === 0 || order < 0 || order >= m || m > n) return values.map((v) => (isSolError(v) ? v : null));
  const h = (m - 1) >> 1;
  return values.map((v, i) => {
    if (isSolError(v)) return v;
    if (!finite(v)) return null;
    const start = Math.max(0, Math.min(i - h, n - m));
    const xs: number[] = [], ys: number[] = [], ws: number[] = [];
    for (let j = start; j < start + m; j++) {
      const y = values[j];
      if (!finite(y)) continue;
      xs.push(j - i); ys.push(y); ws.push(1);
    }
    const c = polyFitW(xs, ys, ws, order);
    return c ? c[0] : null;
  });
}

/** Gaussian smoothing with a truncated kernel (4σ each side), reflect padding, like
 *  gaussian_filter1d's default; blank cells are skipped (normalised over the present
 *  weights) and stay blank themselves. */
export function gaussianSmooth(values: readonly Cell[], sigma: number): Cell[] {
  const n = values.length;
  if (!(sigma > 0)) return values.map((v) => (isSolError(v) ? v : finite(v) ? v : null));
  const r = Math.ceil(4 * sigma);
  const k: number[] = [];
  for (let d = -r; d <= r; d++) k.push(Math.exp(-(d * d) / (2 * sigma * sigma)));
  const reflect = (j: number): number => {
    // scipy "reflect": (d c b a | a b c d | d c b a)
    const period = 2 * n;
    let t = ((j % period) + period) % period;
    if (t >= n) t = period - 1 - t;
    return t;
  };
  return values.map((v, i) => {
    if (isSolError(v)) return v;
    if (!finite(v)) return null;
    let num = 0, den = 0;
    for (let d = -r; d <= r; d++) {
      const y = values[reflect(i + d)];
      if (!finite(y)) continue;
      const w = k[d + r];
      num += w * y; den += w;
    }
    return den > 0 ? num / den : null;
  });
}

/** LOWESS over positions 1..n: local linear fit with tricube weights over the nearest
 *  `frac·n` points, then `iterations` bisquare robustness passes (Cleveland 1979 — the
 *  statsmodels / R lowess default shape; R adds a delta speed-up we don't need). */
export function lowess(values: readonly Cell[], frac = 2 / 3, iterations = 3): Cell[] {
  const idx: number[] = [], ys: number[] = [];
  values.forEach((v, i) => { if (finite(v)) { idx.push(i); ys.push(v); } });
  const n = idx.length;
  const out: Cell[] = values.map((v) => (isSolError(v) ? v : null));
  if (n === 0) return out;
  if (n < 3) { idx.forEach((i, k) => { out[i] = ys[k]; }); return out; }
  const r = Math.min(n, Math.max(2, Math.ceil(Math.max(0, Math.min(1, frac)) * n)));
  const xs = idx.map((i) => i);
  let robust = new Array<number>(n).fill(1);
  let fitted = new Array<number>(n).fill(0);
  for (let it = 0; it <= iterations; it++) {
    for (let k = 0; k < n; k++) {
      const x0 = xs[k];
      // the r nearest neighbours by |x - x0|
      const dist = xs.map((x) => Math.abs(x - x0)).sort((a, b) => a - b);
      const hmax = dist[r - 1] || 1e-12;
      const ws = xs.map((x, j) => {
        const u = Math.abs(x - x0) / hmax;
        const tri = u < 1 ? Math.pow(1 - u ** 3, 3) : 0;
        return tri * robust[j];
      });
      const c = polyFitW(xs.map((x) => x - x0), ys, ws, 1) ?? polyFitW(xs.map((x) => x - x0), ys, ws, 0);
      fitted[k] = c ? c[0] : ys[k];
    }
    if (it === iterations) break;
    const resid = ys.map((y, k) => y - fitted[k]);
    const sorted = resid.map(Math.abs).sort((a, b) => a - b);
    const mad = sorted.length % 2 ? sorted[(sorted.length - 1) >> 1] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    if (mad === 0) break;
    robust = resid.map((e) => { const u = e / (6 * mad); return Math.abs(u) < 1 ? (1 - u * u) ** 2 : 0; });
  }
  idx.forEach((i, k) => { out[i] = fitted[k]; });
  return out;
}

export interface PeakOptions { height?: number; distance?: number; prominence?: number }
export interface Peak { position: number; value: number; prominence: number }

/** scipy.signal.find_peaks: strict local maxima (a flat top counts once, at its middle),
 *  filtered by minimum height, minimum prominence, then a greedy minimum distance
 *  (highest peaks win). Positions are 1-based. Blank / error cells break the signal. */
export function findPeaks(values: readonly Cell[], opts: PeakOptions = {}): Peak[] {
  const n = values.length;
  const y = (i: number) => { const v = values[i]; return finite(v) ? v : NaN; };
  const peaks: number[] = [];
  for (let i = 1; i < n - 1; ) {
    const yi = y(i);
    if (Number.isNaN(yi) || !(yi > y(i - 1))) { i++; continue; }
    let j = i;
    while (j + 1 < n && y(j + 1) === yi) j++; // plateau
    if (j + 1 < n && yi > y(j + 1)) peaks.push((i + j) >> 1);
    i = j + 1;
  }
  let keep = peaks.filter((p) => opts.height === undefined || y(p) >= opts.height);
  // prominence: the drop to the higher of the two base minima, each taken between the
  // peak and the nearest higher point on that side (or the signal's end)
  const prominenceOf = (p: number): number => {
    const yp = y(p);
    let leftMin = yp;
    for (let i = p - 1; i >= 0; i--) { const v = y(i); if (Number.isNaN(v) || v > yp) break; if (v < leftMin) leftMin = v; }
    let rightMin = yp;
    for (let i = p + 1; i < n; i++) { const v = y(i); if (Number.isNaN(v) || v > yp) break; if (v < rightMin) rightMin = v; }
    return yp - Math.max(leftMin, rightMin);
  };
  let out: Peak[] = keep.map((p) => ({ position: p + 1, value: y(p), prominence: prominenceOf(p) }));
  if (opts.prominence !== undefined) out = out.filter((pk) => pk.prominence >= opts.prominence!);
  if (opts.distance !== undefined && opts.distance > 1) {
    const d = opts.distance;
    const byHeight = [...out].sort((a, b) => b.value - a.value || a.position - b.position);
    const removed = new Set<number>();
    for (const pk of byHeight) {
      if (removed.has(pk.position)) continue;
      for (const other of out) {
        if (other.position !== pk.position && !removed.has(other.position) && Math.abs(other.position - pk.position) < d) removed.add(other.position);
      }
    }
    out = out.filter((pk) => !removed.has(pk.position));
  }
  return out;
}
