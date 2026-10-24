// [[C17]] shareImpl
import { isSolError, type SolError } from "../errorValue";

export type Cell = number | null | SolError;

export function firstError(arr: readonly unknown[]): SolError | null {
  for (const v of arr) if (isSolError(v)) return v;
  return null;
}

// ─── Shape: list in, list out ─────────────────────────────────────────────────

export type PadDir = "right" | "left";

export type RunningOp = "sum" | "avg" | "min" | "max" | "median" | "product" | "stdev";

// ─── Find: list in, scalar out ────────────────────────────────────────────────

export type ArgMinMaxOp = "argmax" | "argmin" | "argsort" | "argsort_desc" | "which";
export const ARG_LIST_OPS: ReadonlySet<ArgMinMaxOp> = new Set(["argsort", "argsort_desc", "which"]);

export type XMatchMatchMode = "exact" | "next_larger" | "next_smaller";
export type XMatchSearchMode = "first" | "last";

// ─── Weighted statistics ──────────────────────────────────────────────────────

export type WeightedOp = "wavg" | "wvar" | "wstdev";

// ─── Sets ─────────────────────────────────────────────────────────────────────

export type SetOp = "union" | "intersect" | "difference" | "symdiff";

export type SetRelation = "equal" | "subset" | "superset" | "disjoint";

// ─── Fill / Coalesce — the opt-in to treat a missing as something ──────────────

export type FillOp =
  | "constant" | "ffill" | "bfill" | "mean" | "median" | "mode"
  | "interpolate" | "drop" | "coalesce";

// ─── Shuffle ──────────────────────────────────────────────────────────────────

export function weightedShuffleKey(u: number, weight: number): number {
  if (!(weight > 0) || !Number.isFinite(weight)) return Infinity;
  const uu = u <= 0 ? Number.EPSILON : u >= 1 ? 1 - Number.EPSILON : u;
  return -Math.log(uu) / weight;
}

export type OutlierMethod = "z" | "iqr" | "mad";

export function fftReal(x: readonly number[]): { re: number[]; im: number[] } {
  const n = x.length;
  if (n === 0) return { re: [], im: [] };
  if (n === 1) return { re: [x[0]], im: [0] };
  const isPow2 = (n & (n - 1)) === 0;
  const re = [...x], im = new Array<number>(n).fill(0);
  if (isPow2) { fftInPlace(re, im, false); return { re, im }; }
  // Bluestein: multiply by the chirp, convolve with its conjugate through a power-of-two FFT of size m ≥ 2n−1, multiply back.
  let m = 1; while (m < 2 * n - 1) m <<= 1;
  const cosT: number[] = [], sinT: number[] = [];
  for (let k = 0; k < n; k++) { const ang = (Math.PI * ((k * k) % (2 * n))) / n; cosT.push(Math.cos(ang)); sinT.push(Math.sin(ang)); }
  const aRe = new Array<number>(m).fill(0), aIm = new Array<number>(m).fill(0);
  for (let k = 0; k < n; k++) { aRe[k] = x[k] * cosT[k]; aIm[k] = -x[k] * sinT[k]; }
  const bRe = new Array<number>(m).fill(0), bIm = new Array<number>(m).fill(0);
  bRe[0] = cosT[0]; bIm[0] = sinT[0];
  for (let k = 1; k < n; k++) { bRe[k] = bRe[m - k] = cosT[k]; bIm[k] = bIm[m - k] = sinT[k]; }
  fftInPlace(aRe, aIm, false); fftInPlace(bRe, bIm, false);
  for (let k = 0; k < m; k++) { const r = aRe[k] * bRe[k] - aIm[k] * bIm[k]; const i = aRe[k] * bIm[k] + aIm[k] * bRe[k]; aRe[k] = r; aIm[k] = i; }
  fftInPlace(aRe, aIm, true);
  const outRe: number[] = [], outIm: number[] = [];
  for (let k = 0; k < n; k++) { outRe.push(aRe[k] * cosT[k] + aIm[k] * sinT[k]); outIm.push(aIm[k] * cosT[k] - aRe[k] * sinT[k]); }
  return { re: outRe, im: outIm };
}

function fftInPlace(re: number[], im: number[], inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cRe = 1, cIm = 0;
      for (let j = 0; j < len / 2; j++) {
        const uRe = re[i + j], uIm = im[i + j];
        const vRe = re[i + j + len / 2] * cRe - im[i + j + len / 2] * cIm;
        const vIm = re[i + j + len / 2] * cIm + im[i + j + len / 2] * cRe;
        re[i + j] = uRe + vRe; im[i + j] = uIm + vIm;
        re[i + j + len / 2] = uRe - vRe; im[i + j + len / 2] = uIm - vIm;
        const nRe = cRe * wRe - cIm * wIm; cIm = cRe * wIm + cIm * wRe; cRe = nRe;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

export interface SpectrumRow { bin: number; frequency: number; magnitude: number; phase: number }
export function spectrum(x: readonly Cell[], rate: number | SolError = 1): SpectrumRow[] | SolError {
  if (isSolError(rate)) return rate;
  const err = firstError(x);
  if (err) return err;
  const sig = x.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : 0));
  const n = sig.length;
  if (n === 0) return [];
  const { re, im } = fftReal(sig);
  const rows: SpectrumRow[] = [];
  const half = Math.floor(n / 2);
  for (let k = 0; k <= half; k++) {
    const mag = Math.hypot(re[k], im[k]);
    const scale = k === 0 || (n % 2 === 0 && k === half) ? 1 / n : 2 / n;
    rows.push({ bin: k, frequency: (k * rate) / n, magnitude: mag * scale, phase: Math.atan2(im[k], re[k]) });
  }
  return rows;
}

