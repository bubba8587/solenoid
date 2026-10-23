// [[C17]] shareImpl, [[C24]] arraySemantics, [[D36]] nullSkippedNotZero
import { isSolError, type SolError } from "../errorValue";
import { matSolve } from "./matrixOps";

export type Cell = number | null | SolError;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

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

export function savgolProblem(n: number, window: number, order: number): string | null {
  if (!Number.isInteger(window)) return "Window must be a whole number";
  if (!Number.isInteger(order)) return "Order must be a whole number";
  const m = Math.max(1, window);
  if (m % 2 === 0) return "Window must be odd";
  if (order < 0 || order >= m) return "Order must be below the window";
  if (m > n) return "Window is longer than the list";
  return null;
}

export function savgol(values: readonly Cell[], window: number, order: number): Cell[] {
  const n = values.length;
  const m = Math.max(1, Math.floor(window));
  if (savgolProblem(n, window, order)) return values.map((v) => (isSolError(v) ? v : null));
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

