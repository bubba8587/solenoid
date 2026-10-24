// [[C129]] describeDashboard
import { frameRowCount, type FrameCell, type FrameColType, type FrameValue } from "./frame";
import { isSolError } from "./errorValue";
import { frameSidecar } from "./frameSidecar";
import { equalWidthBins, sparklineSeries } from "./nodes/visualOps";
import type { FormatAnnotation } from "./formatAnnotationStore";

/** How many most common values a tile lists. */
export const TOP_VALUES = 5;
/** A number column with this few distinct values lists them, as a text column does: a histogram of two years is two bars and a gap. */
export const FEW_VALUES = 6;

/** One column's tile on the Dashboard view: what the summary row says, plus what its charts draw. */
export interface DescribeTile {
  name: string;
  type: FrameColType;
  format?: FormatAnnotation;
  count: number;
  blank: number;
  distinct: number;
  /** A number column's mean and median, from the summary. */
  mean?: number | null;
  median?: number | null;
  /** A number or date column's histogram: equal-width bins from `min` to `max`. */
  hist?: { counts: number[]; min: number; max: number };
  /** A number column's values in row order, averaged into buckets past the sparkline's cap. */
  trend?: number[];
  /** A text or logical column's most common values (or a number column's with few distinct values), most first, and how many rows hold any other. */
  top?: { values: { text: string; count: number }[]; other: number };
}

const tiles = frameSidecar<DescribeTile[]>((f, t) => t.length === frameRowCount(f));
export const describeTilesOf = tiles.of;

/** Sturges' bin count, kept between 5 and 20 so a tile's bars stay readable. */
export function binCount(n: number): number {
  return Math.min(20, Math.max(5, Math.ceil(Math.log2(Math.max(1, n)) + 1)));
}

function histogramOf(nums: readonly number[]): DescribeTile["hist"] {
  if (nums.length === 0) return undefined;
  let min = Infinity, max = -Infinity;
  for (const x of nums) { if (x < min) min = x; if (x > max) max = x; }
  if (min === max) return { counts: [nums.length], min, max };
  const k = binCount(nums.length);
  const counts = new Array<number>(k).fill(0);
  const { idx } = equalWidthBins(min, max, k);
  for (const x of nums) counts[idx(x)]++;
  return { counts, min, max };
}

function topOf(values: readonly FrameCell[]): DescribeTile["top"] {
  const counts = new Map<string, number>();
  let filled = 0;
  for (const v of values) {
    if (v == null) continue;
    filled++;
    const k = isSolError(v) ? v.code : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).slice(0, TOP_VALUES);
  const shown = ranked.reduce((s, [, c]) => s + c, 0);
  return { values: ranked.map(([text, count]) => ({ text, count })), other: filled - shown };
}

/** One tile per source column, read beside Describe's summary rows (`summary`), which already hold the counts. */
export function buildDescribeTiles(src: FrameValue, summary: FrameValue): DescribeTile[] {
  const col = (name: string) => summary.columns.find((c) => c.name === name)?.values ?? [];
  const count = col("count"), blank = col("blank"), distinct = col("distinct"), mean = col("mean"), median = col("50%");
  const num = (v: FrameCell | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return src.columns.map((c, j) => {
    const tile: DescribeTile = {
      name: c.name, type: c.type, ...(c.format ? { format: c.format } : {}),
      count: Number(count[j] ?? 0), blank: Number(blank[j] ?? 0), distinct: Number(distinct[j] ?? 0),
    };
    if ((c.type === "number" || c.type === "date") && tile.distinct > FEW_VALUES) {
      const nums: number[] = [];
      for (const v of c.values) if (typeof v === "number" && Number.isFinite(v)) nums.push(v);
      tile.hist = histogramOf(nums);
      if (c.type === "number") {
        tile.mean = num(mean[j]);
        tile.median = num(median[j]);
        if (nums.length > 1) tile.trend = sparklineSeries(nums);
      }
    } else {
      tile.top = topOf(c.values);
      if (c.type === "number") { tile.mean = num(mean[j]); tile.median = num(median[j]); }
    }
    return tile;
  });
}

/** Describe's summary with its tiles kept beside it. */
export function withDescribeTiles(src: FrameValue, summary: FrameValue): FrameValue {
  tiles.set(summary, buildDescribeTiles(src, summary));
  return summary;
}
