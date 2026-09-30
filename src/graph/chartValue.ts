// [[C100]] chartIsAValue
import type { CardColType, CardPlan } from "./cardLayout";
import { formatNumberWithAnnotation, isDateStyle, type FormatAnnotation } from "./formatAnnotationStore";
import { type ChartOp, CHART_OP_META } from "./nodes/visual";
import type { ChartOptions, LineStyle } from "./nodes/chartOptions";
import type { GanttPayload } from "@solenoid/gantt-layout";

export interface KpiPayload {
  kind: "kpi";
  value: number | null;
  prev: number | null;
  unit: string;
  goodUp: boolean;
}
export interface ScalePayload {
  kind: "scale";
  style: "dial" | "bar";
  value: number | null;
  target: number | null;
  min: number;
  max: number;
}
export interface ProportionPayload {
  kind: "proportion";
  layout: "treemap" | "waffle";
  names: string[];
  values: number[];
}
export interface SankeyPayload {
  kind: "sankey";
  sources: string[];
  targets: string[];
  values: number[];
}
export interface SurfacePayload {
  kind: "surface";
  xs: number[];
  ys: number[];
  z: (number | null)[][];
  yaw: number;
  pitch: number;
}
export interface ContourPayload {
  kind: "contour";
  xs: number[];
  ys: number[];
  z: (number | null)[][];
  levels: number;
}
export interface WaterfallPayload {
  kind: "waterfall";
  names: string[];
  values: (number | null)[];
  total: boolean;
}
export interface CandlePayload {
  kind: "candle";
  labels: string[];
  open: (number | null)[];
  high: (number | null)[];
  low: (number | null)[];
  close: (number | null)[];
}
export interface BoxplotPayload {
  kind: "boxplot";
  boxes: Array<{ name: string; lo: number; q1: number; med: number; q3: number; hi: number; outliers: number[] }>;
}
export interface CalHeatPayload {
  kind: "calheat";
  days: number[];
  values: number[];
}
export interface HeatmapPayload {
  kind: "heatmap";
  /** `z[r][c]`, row-major as the table reads; null is a gap. */
  z: (number | null)[][];
  rows: string[];
  cols: string[];
  /** Set only when the table was cut to `HEATMAP_MAX` rows or columns. */
  totalRows?: number;
  totalCols?: number;
}
export interface QuiverPayload {
  kind: "quiver";
  u: (number | null)[][];
  v: (number | null)[][];
}
export interface RecordField {
  label: string;
  value: number | string | null;
  /** A number's column format, read by `recordNumberText` when drawn. */
  format?: FormatAnnotation;
  image?: string;
  hint?: string;
  isTitle?: boolean;
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
}
export type RecordSize = "s" | "m" | "l";

export function titleIndexFor(fields: RecordField[]): number {
  const marked = fields.findIndex((f) => f.isTitle);
  return marked >= 0 ? marked : fields.length > 0 ? 0 : -1;
}

/** The Cards view's rows: every column's name, type and format, the plan, and each drawn row's cells (numbers raw, everything else as shown) and row number. */
/** A Record number's text: its column's number format, else Auto; never its unit, which the label carries. */
export function recordNumberText(v: number, fmt: FormatAnnotation | null | undefined): string {
  return formatNumberWithAnnotation(v, fmt && !isDateStyle(fmt.format) ? { ...fmt, unit: "none" } : { format: "auto", unit: "none" });
}

export function recordFieldText(f: RecordField): string {
  if (f.value === null) return f.hint ?? "—";
  return typeof f.value === "number" ? recordNumberText(f.value, f.format) : f.value;
}

export interface RecordDeck {
  names: string[];
  types: CardColType[];
  formats: (FormatAnnotation | null)[];
  chipCols: number[];
  plan: CardPlan;
  rows: (number | string | null)[][];
  /** Each drawn row's 1-based number in the frame. */
  rowNumbers: number[];
}
export interface RecordPayload {
  kind: "record";
  view: "detail" | "cards" | "gallery" | "board" | "list";
  deck?: RecordDeck;
  cols: number;
  cards: RecordField[][];
  lanes?: Array<{ label: string; cards: number[] }>;
  more?: number;
  size?: RecordSize;
  clamp?: boolean;
  index: number;
  total: number;
}
export interface OverlaySeries {
  name: string;
  kind: "line" | "area" | "column" | "bar";
  values: (number | null)[];
  color?: string;
  markersize?: number;
  linewidth?: number;
  alpha?: number;
  marker?: boolean;
}
export interface OverlayPayload {
  kind: "overlay";
  series: OverlaySeries[];
  labels?: (string | number)[];
}
export interface XYPoint {
  x: number;
  y: number;
  s?: number;
  c?: number | string;
  text?: string;
}
export interface XYSeries {
  name: string;
  /** In row order; null is a gap, where a connecting line breaks. */
  points: (XYPoint | null)[];
  line: LineStyle;
  marker: boolean;
  color?: string;
  markersize?: number;
  linewidth?: number;
  alpha?: number;
  sRange?: [number, number];
  cRange?: [number, number];
  cCats?: string[];
}
export interface XYPayload {
  kind: "xy";
  series: XYSeries[];
  /** Set when x is a text column: each x is an index into these. */
  xcats?: string[];
  names: { x?: string; y?: string; s?: string; c?: string; text?: string };
}
export type ChartPayload =
  | KpiPayload | ScalePayload | ProportionPayload | SankeyPayload | SurfacePayload
  | ContourPayload | WaterfallPayload | CandlePayload | BoxplotPayload
  | CalHeatPayload | HeatmapPayload | QuiverPayload | RecordPayload | OverlayPayload
  | XYPayload | GanttPayload;

export const CHART_SPECIAL_OPS = [
  "kpi", "scale", "proportion", "sankey", "surface", "contour", "waterfall",
  "candle", "boxplot", "calheat", "heatmap", "quiver", "record", "overlay", "gantt",
] as const;

export type ChartValueOp = ChartOp | (typeof CHART_SPECIAL_OPS)[number];

/** Lazy: `CHART_OP_META`'s module imports this one back, so reading it at load time sees it half-initialized. */
export function chartValueOps(): readonly ChartValueOp[] {
  return [...(Object.keys(CHART_OP_META) as ChartOp[]), ...CHART_SPECIAL_OPS];
}

export interface ChartValue {
  __chart: true;
  op: ChartValueOp;
  values: number | number[] | null;
  series?: { name: string; values: (number | null)[] }[];
  labels?: (string | number)[];
  payload?: ChartPayload;
  options: ChartOptions;
  title?: string;
}

export function isChartValue(v: unknown): v is ChartValue {
  return typeof v === "object" && v !== null && (v as { __chart?: unknown }).__chart === true;
}
