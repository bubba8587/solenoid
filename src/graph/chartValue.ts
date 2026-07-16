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
// A shaded 3-D surface over a coordinate grid: `z[iy][ix]` is the height at
// (ys[iy], xs[ix]); a null cell is a hole (no quad drawn). The axes carry the real
// coordinates so the surface honours non-uniform spacing. Parsed from the same
// bordered table the Grid Interpolate node reads (row 1 = Xs, column 1 = Ys).
export interface SurfacePayload {
  kind: "surface";
  xs: number[];
  ys: number[];
  z: (number | null)[][];
  /** View angles in DEGREES: yaw around the vertical (Z) axis, pitch (elevation)
   *  around the screen-horizontal. The node's rotate buttons step these by 45°. */
  yaw: number;
  pitch: number;
}
// The flat twin of Surface: same bordered grid (xs/ys axes + z heights), drawn
// as filled height bands with iso-lines instead of a 3-D mesh. `levels` is the
// iso-line count between the data's own min and max.
export interface ContourPayload {
  kind: "contour";
  xs: number[];
  ys: number[];
  z: (number | null)[][];
  levels: number;
}
// A waterfall: each (name, value) is a signed delta from the running total; a
// computed Total bar is appended when `total`.
export interface WaterfallPayload {
  kind: "waterfall";
  names: string[];
  values: number[];
  total: boolean;
}
// OHLC candles, parallel per index; labels are the (formatted) x-axis dates.
export interface CandlePayload {
  kind: "candle";
  labels: string[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
}
// One box per series: Tukey five-number summary + the outliers beyond the
// 1.5·IQR whiskers. Stats are computed in the node, so the view stays dumb.
export interface BoxplotPayload {
  kind: "boxplot";
  boxes: Array<{ name: string; lo: number; q1: number; med: number; q3: number; hi: number; outliers: number[] }>;
}
// A calendar heatmap: parallel (date serial, value) pairs; the view lays out
// weeks × weekdays over the data's own date span (capped at a year).
export interface CalHeatPayload {
  kind: "calheat";
  days: number[];
  values: number[];
}
// A waffle: category shares as a 10×10 grid. A single value in [0,1] renders as
// a fraction of the grid instead of a share of the (trivial) total.
export interface WafflePayload {
  kind: "waffle";
  names: string[];
  values: number[];
}
// A vector field: u/v are same-shaped matrices of the x/y components; one arrow
// per cell, coloured by magnitude. A null in either component skips the cell.
export interface QuiverPayload {
  kind: "quiver";
  u: (number | null)[][];
  v: (number | null)[][];
}
export type ChartPayload =
  | KpiPayload | BulletPayload | TreemapPayload | SankeyPayload | SurfacePayload
  | ContourPayload | WaterfallPayload | CandlePayload | BoxplotPayload
  | CalHeatPayload | WafflePayload | QuiverPayload;

/** Every op the `chart` socket can carry: the ChartView series shapes, the
 *  structured-payload figures rendered outside recharts (kpi/bullet), and the
 *  structured recharts figures (treemap/sankey). */
export type ChartValueOp =
  | ChartOp | "kpi" | "bullet" | "treemap" | "sankey" | "surface"
  | "contour" | "waterfall" | "candle" | "boxplot" | "calheat" | "waffle" | "quiver";

export interface ChartValue {
  __chart: true;
  op: ChartValueOp;
  /** The raw values the figure plots — a consumer runs them through toSeries.
   *  Unused by payload figures (kpi/bullet), which read `payload`. */
  values: number | number[] | null;
  /** Multi-series / point data for the 2-D chart ops (composed = each COLUMN a
   *  series; bubble = each ROW an [x, y, size] point). Undefined for 1-D ops. */
  matrix?: (number | null)[][] | null;
  /** X-axis category labels — the FIRST column of a wired Frame (formatted per its
   *  type, so dates read as dates). One per data point; the axis/tooltip show these
   *  instead of the 1,2,3… index. Undefined when a plain `values` list drives it. */
  labels?: (string | number)[];
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
