import type { ChartOp } from "./nodes/visual";
import type { ChartOptions } from "./nodes/chartOptions";

// What the `chart` socket carries: a self-describing figure. Must stay flat +
// JSON-safe so it rides a cable and serializes like any other value.

// Figures that don't fit a numeric series carry structured data in `payload`.
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
// A flat labeled treemap — each name/value pair is a rectangle sized by value.
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
// `z[iy][ix]` is the height at (ys[iy], xs[ix]) and a null cell is a hole; the axes
// carry real coordinates, so non-uniform spacing is honoured.
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
// The flat twin of Surface, drawn as filled height bands; `levels` is the iso-line
// count between the data's own min and max.
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
// Tukey five-number summary + outliers beyond the 1.5·IQR whiskers, computed in
// the node so the view stays dumb.
export interface BoxplotPayload {
  kind: "boxplot";
  boxes: Array<{ name: string; lo: number; q1: number; med: number; q3: number; hi: number; outliers: number[] }>;
}
// Parallel (date serial, value) pairs; the view lays out weeks × weekdays over the
// data's own date span, capped at a year.
export interface CalHeatPayload {
  kind: "calheat";
  days: number[];
  values: number[];
}
// Category shares as a 10×10 grid; a single value in [0,1] renders as a fraction.
export interface WafflePayload {
  kind: "waffle";
  names: string[];
  values: number[];
}
// A vector field: u/v are same-shaped matrices of the x/y components; one arrow
// per cell, colored by magnitude. A null in either component skips the cell.
export interface QuiverPayload {
  kind: "quiver";
  u: (number | null)[][];
  v: (number | null)[][];
}
// A seven-segment readout: the display TEXT (digits / '-' / '.', already
// fixed-decimals or the all-dash overflow), rendered as flat SVG segments.
export interface SevenSegPayload {
  kind: "sevenseg";
  text: string;
}
// One labeled box of a record card, pre-placed on the grid (1-based CSS grid
// lines, resolved from the layout text in the node so the view stays dumb).
export interface RecordField {
  label: string;
  /** The cell for display: dates/booleans/errors arrive pre-formatted as text,
   *  numbers stay numeric so the view applies the standard scalar format;
   *  null = an empty cell. */
  value: number | string | null;
  /** An image source when the cell text points at one; the box shows the picture. */
  image?: string;
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
}
// A record card: one frame row as labeled boxes on a grid. `index`/`total` are
// the 1-based record position and row count (index 0 = no record selected).
export interface RecordPayload {
  kind: "record";
  fields: RecordField[];
  /** Grid column count (the widest layout row). */
  cols: number;
  index: number;
  total: number;
}
export type ChartPayload =
  | KpiPayload | BulletPayload | TreemapPayload | SankeyPayload | SurfacePayload
  | ContourPayload | WaterfallPayload | CandlePayload | BoxplotPayload
  | CalHeatPayload | WafflePayload | QuiverPayload | SevenSegPayload | RecordPayload;

/** Every op the `chart` socket can carry. */
export type ChartValueOp =
  | ChartOp | "kpi" | "bullet" | "treemap" | "sankey" | "surface"
  | "contour" | "waterfall" | "candle" | "boxplot" | "calheat" | "waffle" | "quiver" | "sevenseg" | "record";

export interface ChartValue {
  __chart: true;
  op: ChartValueOp;
  /** The raw values the figure plots; unused by the payload figures. */
  values: number | number[] | null;
  /** Multi-series / point data for the 2-D chart ops (composed = each COLUMN a
   *  series; bubble = each ROW an [x, y, size] point). Undefined for 1-D ops. */
  matrix?: (number | null)[][] | null;
  /** X-axis category labels, one per data point, shown instead of the 1,2,3…
   *  index; undefined when a plain `values` list drives the figure. */
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
