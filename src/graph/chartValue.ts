import type { ChartOp } from "./nodes/visual";
import type { ChartOptions } from "./nodes/chartOptions";

// ─── Chart as a first-class value ─────────────────────────────────────────────
// The `chart` socket (sockets.ts — the object-socket family's member alongside
// `lambda`, identity-only + `any`) carries THIS: a self-describing figure a
// consumer can redraw without knowing about the Chart node. The Chart node emits
// one; the Report renders it inline where its `=name` ref sits (the main
// destination for charts). Deliberately flat + JSON-safe (op/values/options are
// all primitives or plain objects) so it rides a cable and serializes like any
// other value.

export interface ChartValue {
  __chart: true;
  op: ChartOp;
  /** The raw values the figure plots — a consumer runs them through toSeries. */
  values: number | number[] | null;
  /** Parsed matplotlib-style style overrides (title/axes/color/grid/…). */
  options: ChartOptions;
  /** Display title — the Options `title`, else the node label. */
  title?: string;
}

export function isChartValue(v: unknown): v is ChartValue {
  return typeof v === "object" && v !== null && (v as { __chart?: unknown }).__chart === true;
}
