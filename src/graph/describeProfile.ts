// [[C129]] describeDashboard
import { frameRowCount, type FrameColType } from "./frame";
import { frameSidecar } from "./frameSidecar";
import type { FormatAnnotation } from "./formatAnnotationStore";

/** One column's tile on the Dashboard view: what the summary row says, plus what its charts draw. Describe's body
 *  on the core makes them (`describe_tiles`, `nodes/frames.rs`). */
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
/** Describe's summary keeps its tiles beside it. */
export const setDescribeTiles = tiles.set;
export const describeTilesOf = tiles.of;
