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

// A few figure types don't fit a plain numeric series — a KPI card is a value +
// its prior, a bullet graph is a value against a target on a scale. They still ride
// the `chart` socket as a ChartValue (so a Report embeds them for free), carrying
// their structured data in `payload` instead of `values`. JSON-safe (flat numbers).
export interface KpiPayload {
  kind: "kpi";
  value: number | null;
  prev: number | null;
  /** A short unit/suffix shown after the number (e.g. "$", "%", "ms"). */
  unit: string;
  /** Whether an increase is "good" (green ↑) — flip for cost-style metrics. */
  goodUp: boolean;
}
export interface BulletPayload {
  kind: "bullet";
  value: number | null;
  target: number | null;
  min: number;
  max: number;
}
// A flat labelled treemap — each name/value pair is a rectangle sized by value.
// (Nested hierarchy is a later extension; v1 is one level.)
export interface TreemapPayload {
  kind: "treemap";
  names: string[];
  values: number[];
}
// A Sankey flow — parallel edge lists (source[i] → target[i] carries value[i]).
// Nodes are derived from the unique names across both ends.
export interface SankeyPayload {
  kind: "sankey";
  sources: string[];
  targets: string[];
  values: number[];
}
export type ChartPayload = KpiPayload | BulletPayload | TreemapPayload | SankeyPayload;

/** Every op the `chart` socket can carry: the ChartView series shapes, the
 *  structured-payload figures rendered outside recharts (kpi/bullet), and the
 *  structured recharts figures (treemap/sankey). */
export type ChartValueOp = ChartOp | "kpi" | "bullet" | "treemap" | "sankey";

export interface ChartValue {
  __chart: true;
  op: ChartValueOp;
  /** The raw values the figure plots — a consumer runs them through toSeries.
   *  Unused by payload figures (kpi/bullet), which read `payload`. */
  values: number | number[] | null;
  /** Structured data for the non-series figures (kpi/bullet). */
  payload?: ChartPayload;
  /** Parsed matplotlib-style style overrides (title/axes/color/grid/…). */
  options: ChartOptions;
  /** Display title — the Options `title`, else the node label. */
  title?: string;
}

export function isChartValue(v: unknown): v is ChartValue {
  return typeof v === "object" && v !== null && (v as { __chart?: unknown }).__chart === true;
}
