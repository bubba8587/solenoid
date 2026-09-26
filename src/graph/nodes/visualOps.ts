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

// ─── Sparkline picture ([[D82]] sparklineCell) ───────────────────────────────

export type SparklineOp = "line" | "column" | "winloss";
export const SPARKLINE_OPS: readonly SparklineOp[] = ["line", "column", "winloss"];
export const SPARKLINE_MAX_POINTS = 40;
const SPARK_W = 80;
const SPARK_H = 20;
const SPARK_COLOR = { line: "#f5b914", pos: "#00b862", neg: "#e0473a" } as const;

/** The numbers in order, averaged into `SPARKLINE_MAX_POINTS` buckets past the cap; anything else is skipped. */
export function sparklineSeries(values: readonly unknown[]): number[] {
  const nums: number[] = [];
  for (const v of values) if (typeof v === "number" && Number.isFinite(v)) nums.push(v);
  const n = nums.length;
  if (n <= SPARKLINE_MAX_POINTS) return nums;
  const out: number[] = [];
  for (let b = 0; b < SPARKLINE_MAX_POINTS; b++) {
    const lo = Math.floor((b * n) / SPARKLINE_MAX_POINTS);
    const hi = Math.floor(((b + 1) * n) / SPARKLINE_MAX_POINTS);
    let s = 0;
    for (let i = lo; i < hi; i++) s += nums[i];
    out.push(s / (hi - lo));
  }
  return out;
}

const r1 = (x: number): string => String(Math.round(x * 10) / 10);

function linePath(ys: readonly number[]): string {
  const pts = ys.length === 1 ? [ys[0], ys[0]] : ys;
  const lo = Math.min(...pts), hi = Math.max(...pts);
  const pad = 1.5;
  const y = (v: number) => (hi === lo ? SPARK_H / 2 : pad + ((hi - v) / (hi - lo)) * (SPARK_H - 2 * pad));
  const step = (SPARK_W - 2 * pad) / (pts.length - 1);
  return pts.map((v, i) => `${i === 0 ? "M" : "L"}${r1(pad + i * step)} ${r1(y(v))}`).join("");
}

function barPaths(ys: readonly number[], signed: boolean): { pos: string; neg: string } {
  const lo = signed ? -1 : Math.min(0, ...ys);
  const hi0 = signed ? 1 : Math.max(0, ...ys);
  const hi = hi0 === lo ? lo + 1 : hi0;
  const y = (v: number) => ((hi - v) / (hi - lo)) * SPARK_H;
  const slot = SPARK_W / ys.length;
  const gap = slot > 3 ? 1 : 0;
  const w = r1(slot - gap);
  const base = y(0);
  let pos = "", neg = "";
  ys.forEach((v0, i) => {
    const v = signed ? Math.sign(v0) : v0;
    if (v === 0) return;
    const top = Math.min(y(v), base);
    const h = Math.max(Math.abs(y(v) - base), 0.5);
    const d = `M${r1(i * slot + gap / 2)} ${r1(top)}h${w}v${r1(h)}h-${w}z`;
    if (v > 0 || !signed) pos += d; else neg += d;
  });
  return { pos, neg };
}

/** A small SVG picture of `values` as `data:image/svg+xml` text; `null` when no value is a number. */
export function sparklineImage(values: readonly unknown[], op: SparklineOp): string | null {
  const ys = sparklineSeries(values);
  if (ys.length === 0) return null;
  let body: string;
  if (op === "line") {
    body = `<path d='${linePath(ys)}' fill='none' stroke='${SPARK_COLOR.line}' stroke-width='1.5' stroke-linejoin='round' stroke-linecap='round'/>`;
  } else {
    const { pos, neg } = barPaths(ys, op === "winloss");
    const posColor = op === "winloss" ? SPARK_COLOR.pos : SPARK_COLOR.line;
    body = (pos ? `<path d='${pos}' fill='${posColor}'/>` : "") + (neg ? `<path d='${neg}' fill='${SPARK_COLOR.neg}'/>` : "");
  }
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${SPARK_W} ${SPARK_H}' width='${SPARK_W}' height='${SPARK_H}'>${body}</svg>`;
  return `data:image/svg+xml,${svg.replace(/%/g, "%25").replace(/#/g, "%23").replace(/</g, "%3C").replace(/>/g, "%3E")}`;
}
