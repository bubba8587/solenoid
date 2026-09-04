import { type ChartOp, CHART_OP_META } from "./nodes/visual";
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
// A value on a fixed scale, drawn one of two ways (the renderer branches on `style`):
// a radial DIAL (value read as a fraction of 1, so 0.75 → 75% on a fixed 0→100% arc) or a
// horizontal BAR on a 0→max track with a target tick (the former Bullet graph). Dial leaves
// `target` null and pins min 0 / max 1; Bar carries the real target and track bound.
export interface ScalePayload {
  kind: "scale";
  style: "dial" | "bar";
  value: number | null;
  target: number | null;
  min: number;
  max: number;
}
// Parts of a whole, laid out two ways: a space-filling treemap (each name/value is a
// rectangle sized by value) or a 10×10 waffle grid of shares. `layout` picks which.
export interface ProportionPayload {
  kind: "proportion";
  layout: "treemap" | "waffle";
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
  /** Layout-authored placeholder, present only when the value is empty; the box
   *  shows it muted in place of the dash. */
  hint?: string;
  /** The title field (a `#name` layout marker): drawn big and label-less. `titleIndexFor`
   *  reads this; the List view leads with it and every card view renders it prominent. */
  isTitle?: boolean;
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
}
/** The gallery tile-size preset (`cardsize` option): small / medium (default) / large. */
export type RecordSize = "s" | "m" | "l";

/** WHICH field is the record's title (the prominent line the List view leads with). The
 *  ONE place this is decided: today the first field, so a per-card title marker (the pending
 *  `#field` layout marker) plugs in HERE and every view follows. */
export function titleIndexFor(fields: RecordField[]): number {
  const marked = fields.findIndex((f) => f.isTitle);
  return marked >= 0 ? marked : fields.length > 0 ? 0 : -1;
}

// The record figure, four views of one layout: `card` draws the picked row,
// `gallery` every row as a grid of cards, `board` every row in lanes keyed by a
// grouping column, `list` every row as an indented outline (title then fields).
// `index`/`total` are the card view's 1-based pick and the row count (index 0 = no
// record selected).
export interface RecordPayload {
  kind: "record";
  view: "card" | "gallery" | "board" | "list";
  /** Grid column count within ONE card (the widest layout row). */
  cols: number;
  /** One entry per drawn card; the card view has exactly one (the picked row). */
  cards: RecordField[][];
  /** Board lanes: label + indices into `cards`; absent for card/gallery/list. */
  lanes?: Array<{ label: string; cards: number[] }>;
  /** Rows beyond the drawing cap (gallery/board/list draw at most the cap). */
  more?: number;
  /** Gallery tile size preset; absent = medium. Gallery view only. */
  size?: RecordSize;
  /** Clamp long tile values to a few lines with an ellipsis (the `clamp` option); the
   *  popup still shows everything. Gallery view only. */
  clamp?: boolean;
  index: number;
  total: number;
}
// One artist in an overlay, carrying its OWN mark kind and the styling it inherited
// from the source chart (Merge Plots keeps each source's color/marker size/etc.). A
// null value is a gap. `bar` and `column` both draw as vertical bars here so they
// share the cartesian x-axis with the line/area/scatter marks.
export interface OverlaySeries {
  name: string;
  kind: "line" | "area" | "column" | "bar" | "scatter";
  values: (number | null)[];
  /** Inherited from the source chart's Options; the palette fills in when absent. */
  color?: string;
  markersize?: number;
  linewidth?: number;
  alpha?: number;
  /** Whether a line/area dots its points (the source's `marker` option). */
  marker?: boolean;
}
// Several charts overlaid on one plot (the Merge Plots node): every source's series
// keep their own kind + styling, drawn together over a shared x-axis. `labels` is the
// first source's category axis, if any.
export interface OverlayPayload {
  kind: "overlay";
  series: OverlaySeries[];
  labels?: (string | number)[];
}
export type ChartPayload =
  | KpiPayload | ScalePayload | ProportionPayload | SankeyPayload | SurfacePayload
  | ContourPayload | WaterfallPayload | CandlePayload | BoxplotPayload
  | CalHeatPayload | QuiverPayload | SevenSegPayload | RecordPayload | OverlayPayload;

/** The payload / special-figure ops beyond the ChartNode's own selectable ChartOps.
 *  The single source of truth (declareOnce) — the union below derives from it, and
 *  `CHART_VALUE_OPS` + `chartPopupCoverage.test.ts` enumerate it, so a new figure op
 *  can't ship without going through the shared popup path. */
export const CHART_SPECIAL_OPS = [
  "kpi", "scale", "proportion", "sankey", "surface", "contour", "waterfall",
  "candle", "boxplot", "calheat", "quiver", "sevenseg", "record", "overlay",
] as const;

/** Every op the `chart` socket can carry. */
export type ChartValueOp = ChartOp | (typeof CHART_SPECIAL_OPS)[number];

/** Every chart op, enumerable at runtime. ChartOps come from `CHART_OP_META`
 *  (which `satisfies Record<ChartOp, …>`, so it is exactly the ChartOp set) and the
 *  specials from `CHART_SPECIAL_OPS`, so this list cannot drift from the type. Lazy:
 *  `CHART_OP_META` lives in a module that cycles back to this one, so reading it at
 *  load time would see it half-initialized. */
export function chartValueOps(): readonly ChartValueOp[] {
  return [...(Object.keys(CHART_OP_META) as ChartOp[]), ...CHART_SPECIAL_OPS];
}

export interface ChartValue {
  __chart: true;
  op: ChartValueOp;
  /** The raw values the figure plots; unused by the payload figures. */
  values: number | number[] | null;
  /** Named series from a frame's numeric columns. For most ops it's set only when ≥ 2
   *  survive the label column (a legend then draws) and `values` mirrors the FIRST series
   *  so every 1-D consumer keeps working; Composed reads them as bar-then-lines and Bubble
   *  as x / y / size columns. Undefined when a plain list or a single column drives the figure. */
  series?: { name: string; values: (number | null)[] }[];
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
