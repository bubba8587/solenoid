// [[C17]] shareImpl
import { clamp, iterMin, iterMax } from "./mathUtils";
import { PALETTE } from "../palette";
import { solError, type SolError } from "../errorValue";

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

/** A bin count below 1, or not a number, has no histogram. */
export function binCountError(k: number): SolError | null {
  return !Number.isFinite(k) || Math.floor(k) < 1 ? solError("#DOMAIN!", "Bins must be 1 or more") : null;
}

/** `counts[yBin][xBin]`: a row per y bin, the app's grid convention. */
export type Histogram2d = { counts: number[][]; xEdges: number[]; yEdges: number[] };

export function histogram2d(xs: readonly unknown[], ys: readonly unknown[], kx: number, ky: number): Histogram2d | SolError | null {
  const bad = binCountError(kx) ?? binCountError(ky);
  if (bad) return bad;
  const px: number[] = [], py: number[] = [];
  const n = Math.min(xs.length, ys.length);
  for (let i = 0; i < n; i++) {
    const x = xs[i], y = ys[i];
    if (typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)) { px.push(x); py.push(y); }
  }
  if (px.length === 0) return null;
  const axis = (nums: number[], k: number) => {
    const min = iterMin(nums), max = iterMax(nums);
    return min === max ? { edges: [min], idx: () => 0 } : equalWidthBins(min, max, clamp(Math.floor(k), 1, 100));
  };
  const ax = axis(px, kx), ay = axis(py, ky);
  const counts = Array.from({ length: ay.edges.length }, () => new Array<number>(ax.edges.length).fill(0));
  for (let i = 0; i < px.length; i++) counts[ay.idx(py[i])][ax.idx(px[i])]++;
  return { counts, xEdges: ax.edges, yEdges: ay.edges };
}

// ─── Sparkline picture ([[D82]] sparklineCell) ───────────────────────────────

export type SparklineOp = "line" | "column" | "winloss";
export const SPARKLINE_MAX_POINTS = 40;
/** The palette slots a sparkline paints in. The picture carries their Default palette hexes; a display repaints them in the active palette. */
export const SPARK_SLOTS = { line: "gold", pos: "green", neg: "vermilion" } as const;
export const SPARK_COLOR = { line: PALETTE.gold, pos: PALETTE.green, neg: PALETTE.vermilion } as const;
const SPARK_MARK = "class='sol-spark'";
const SPARK_HEX_RE = new RegExp(`%23(${Object.values(SPARK_COLOR).map((h) => h.slice(1)).join("|")})`, "gi");

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

/** A sparkline picture repainted in `colors` (hexes by slot); any other picture comes back as it is. */
export function repaintSparkline(src: string, colors: Record<keyof typeof SPARK_SLOTS, string>): string {
  if (!src.startsWith("data:image/svg+xml,") || !src.includes(SPARK_MARK)) return src;
  const bySlot = new Map(Object.entries(SPARK_COLOR).map(([k, h]) => [h.slice(1).toLowerCase(), colors[k as keyof typeof SPARK_SLOTS]]));
  return src.replace(SPARK_HEX_RE, (m, hex: string) => (bySlot.get(hex.toLowerCase()) ?? m).replace("#", "%23"));
}
