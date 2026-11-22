// [[C96]] chartOptionsAreMatplotlib
import type { ChartValueOp } from "../chartValue";

export interface ChartOptions {
  title?: string;
  xlabel?: string;
  ylabel?: string;
  color?: string;
  grid?: boolean;
  /** On, off, or the shape that turns them on (matplotlib's `marker`). */
  marker?: boolean | MarkerShape;
  ymin?: number;
  ymax?: number;
  xmin?: number;
  xmax?: number;
  aspect?: AspectMode;
  /** Calendar Heatmap: sum the days into ISO weeks, months or years. */
  period?: CalendarPeriod;
  yscale?: AxisScale;
  maxgap?: number;
  linestyle?: LineStyle;
  linewidth?: number;
  markersize?: number;
  alpha?: number;
  fontsize?: number;
  pielabels?: PieLabelMode;
  radarscale?: RadarScale;
  stacked?: StackMode;
  /** pandas' `secondary_y`: every series (`True`) or the named ones on a right-hand value axis. */
  secondary_y?: true | string[];
  x?: string;
  y?: string[];
  s?: string;
  c?: string;
  annotate?: string;
  /** The US Map's latitude and longitude columns, by plotly's `scatter_geo` names. */
  lat?: string;
  lon?: string;
  by?: string;
  cmap?: string;
  vmin?: number;
  vmax?: number;
  center?: number;
  annot?: boolean;
  fmt?: string;
  cbar?: boolean;
  origin?: HeatOrigin;
}

type HeatOrigin = "upper" | "lower";
/** recharts' `Symbols` shapes. */
export type MarkerShape = "circle" | "square" | "diamond" | "triangle" | "cross" | "star" | "wye";
export type LineStyle = "solid" | "dashed" | "dotted" | "dashdot" | "none";
type AspectMode = "auto" | "equal";
type AxisScale = "linear" | "log";
type PieLabelMode = "off" | "outside" | "inside";
type RadarScale = "axis" | "shared";
/** The series piled on one another, or each category's piles as shares of 100%. */
export type StackMode = "stacked" | "percent";

// Update these key lists whenever a renderer learns or drops an option.

export type CalendarPeriod = "day" | "week" | "month" | "year";

export type ChartBuilderKey =
  | "title" | "xlabel" | "ylabel" | "color" | "grid" | "marker" | "pielabels" | "radarscale" | "stacked" | "secondary_y" | "zoom"
  | "layout" | "tiers" | "fit" | "critical" | "baseline" | "arrows" | "today" | "weekends" | "labels" | "histogram" | "minutes" | "window" | "columns"
  | "collapse" | "week" | "fiscal_start" | "status" | "group_by"
  | "cardsize" | "clamp"
  | "x" | "y" | "s" | "c" | "annotate" | "by" | "linestyle" | "aspect" | "xmin" | "xmax"
  | "ymin" | "ymax" | "linewidth" | "markersize" | "alpha" | "fontsize"
  | "cmap" | "vmin" | "vmax" | "center" | "annot" | "fmt" | "cbar" | "origin" | "yscale" | "maxgap" | "period";

export type ChartTargetId =
  | "column" | "bar" | "line" | "area" | "scatter" | "xyline"
  | "pie" | "radar" | "radialbar" | "funnel"
  | "bubble" | "overlay"
  | "histogram" | "histogram2d" | "kpi" | "scale" | "proportion" | "sankey"
  | "waterfall" | "candle" | "boxplot" | "calheat" | "heatmap" | "contour" | "surface" | "quiver" | "gantt" | "record";

const XY_KEYS: readonly ChartBuilderKey[] =
  ["title", "xlabel", "ylabel", "color", "grid", "ymin", "ymax", "alpha", "fontsize"];
const BAR_KEYS: readonly ChartBuilderKey[] = [...XY_KEYS, "stacked"];
const COLUMN_KEYS: readonly ChartBuilderKey[] = [...BAR_KEYS, "secondary_y"];
const LINE_KEYS: readonly ChartBuilderKey[] =
  ["title", "xlabel", "ylabel", "color", "grid", "marker", "ymin", "ymax", "linewidth", "markersize", "alpha", "fontsize"];
const AREA_KEYS: readonly ChartBuilderKey[] = [...LINE_KEYS, "stacked", "secondary_y"];
const SCATTER_KEYS: readonly ChartBuilderKey[] =
  ["title", "xlabel", "ylabel", "color", "grid", "marker", "x", "y", "s", "c", "cmap", "annotate", "by", "linestyle", "aspect", "yscale",
    "xmin", "xmax", "ymin", "ymax", "linewidth", "markersize", "alpha", "fontsize"];
const XYLINE_KEYS: readonly ChartBuilderKey[] = [...SCATTER_KEYS, "maxgap"];
const PIE_KEYS: readonly ChartBuilderKey[] = ["title", "fontsize", "pielabels"];
const RADAR_KEYS: readonly ChartBuilderKey[] =
  ["title", "grid", "marker", "radarscale", "ymin", "ymax", "linewidth", "markersize", "alpha", "fontsize"];
const SLICE_KEYS: readonly ChartBuilderKey[] = ["title", "fontsize"];
const OVERLAY_KEYS: readonly ChartBuilderKey[] =
  ["title", "xlabel", "ylabel", "grid", "aspect", "yscale", "xmin", "xmax", "ymin", "ymax", "maxgap", "linewidth", "fontsize"];
const STAT_KEYS: readonly ChartBuilderKey[] = ["title", "fontsize"];
const GANTT_TIMELINE_KEYS: readonly ChartBuilderKey[] =
  ["title", "fontsize", "zoom", "tiers", "layout", "fit", "critical", "baseline", "arrows", "today", "status", "weekends", "labels", "histogram", "minutes", "window", "columns", "collapse", "group_by", "week", "fiscal_start"];
const GANTT_CALENDAR_KEYS: readonly ChartBuilderKey[] =
  ["title", "fontsize", "layout", "critical", "minutes", "window", "week"];
const RECORD_KEYS: readonly ChartBuilderKey[] =
  ["title", "c", "fontsize", "cardsize", "clamp"];
const CALHEAT_KEYS: readonly ChartBuilderKey[] = ["title", "period", "cmap", "center", "vmin", "vmax", "cbar", "fontsize"];
const CONTOUR_KEYS: readonly ChartBuilderKey[] = ["title", "xlabel", "ylabel", "cmap", "center", "vmin", "vmax", "cbar", "fontsize"];
const FIELD_KEYS: readonly ChartBuilderKey[] = ["title", "cmap", "fontsize"];
const HEATMAP_KEYS: readonly ChartBuilderKey[] =
  ["title", "xlabel", "ylabel", "cmap", "center", "vmin", "vmax", "annot", "fmt", "cbar", "aspect", "origin", "fontsize"];

export const CHART_BUILDER_TARGETS: Record<ChartTargetId, { label: string; group: string; op: ChartValueOp; keys: readonly ChartBuilderKey[]; hidden?: boolean }> = {
  column:    { label: "Column",           group: "Cartesian",    op: "column", keys: COLUMN_KEYS },
  bar:       { label: "Bar",              group: "Cartesian",    op: "bar", keys: BAR_KEYS },
  line:      { label: "Line",             group: "Cartesian",    op: "line", keys: [...LINE_KEYS, "secondary_y"] },
  area:      { label: "Area",             group: "Cartesian",    op: "area", keys: AREA_KEYS },
  overlay:   { label: "Merge Plots",      group: "Cartesian",    op: "overlay", keys: OVERLAY_KEYS },
  scatter:   { label: "Scatter",          group: "XY",           op: "scatter", keys: SCATTER_KEYS },
  xyline:    { label: "XY Line",          group: "XY",           op: "xyline", keys: XYLINE_KEYS },
  bubble:    { label: "Bubble",           group: "XY",           op: "bubble", keys: SCATTER_KEYS },
  pie:       { label: "Pie",              group: "Categorical",  op: "pie", keys: PIE_KEYS },
  radar:     { label: "Radar",            group: "Categorical",  op: "radar", keys: RADAR_KEYS },
  radialbar: { label: "Radial",           group: "Categorical",  op: "radialbar", keys: SLICE_KEYS },
  funnel:    { label: "Funnel",           group: "Categorical",  op: "funnel", keys: SLICE_KEYS },
  histogram: { label: "Histogram",        group: "Figures",      op: "column", keys: XY_KEYS },
  histogram2d: { label: "Histogram 2-D",  group: "Figures",      op: "heatmap", keys: HEATMAP_KEYS },
  kpi:       { label: "KPI",              group: "Figures",      op: "kpi", keys: STAT_KEYS },
  scale:     { label: "Gauge",            group: "Figures",      op: "scale", keys: STAT_KEYS },
  proportion: { label: "Proportion",      group: "Figures",      op: "proportion", keys: STAT_KEYS },
  sankey:    { label: "Sankey",           group: "Figures",      op: "sankey", keys: STAT_KEYS },
  waterfall: { label: "Waterfall",        group: "Figures",      op: "waterfall", keys: STAT_KEYS },
  candle:    { label: "Candlestick",      group: "Figures",      op: "candle", keys: STAT_KEYS },
  boxplot:   { label: "Boxplot",          group: "Figures",      op: "boxplot", keys: STAT_KEYS },
  calheat:   { label: "Calendar Heatmap", group: "Figures",      op: "calheat", keys: CALHEAT_KEYS },
  heatmap:   { label: "Heatmap",          group: "Figures",      op: "heatmap", keys: HEATMAP_KEYS },
  contour:   { label: "Contour",          group: "Figures",      op: "contour", keys: CONTOUR_KEYS },
  surface:   { label: "Surface",          group: "Figures",      op: "surface", keys: FIELD_KEYS },
  quiver:    { label: "Vector Field",     group: "Figures",      op: "quiver", keys: FIELD_KEYS },
  gantt:     { label: "Gantt",            group: "Figures",      op: "gantt", keys: GANTT_TIMELINE_KEYS, hidden: true },
  record:    { label: "Record",           group: "Figures",      op: "record", keys: RECORD_KEYS },
};

export const CHART_TARGET_LIST = (Object.keys(CHART_BUILDER_TARGETS) as ChartTargetId[])
  .map((id) => ({ id, ...CHART_BUILDER_TARGETS[id] }));

export function chartBuilderKeys(target: ChartTargetId, layout: string | undefined): readonly ChartBuilderKey[] {
  if (target === "gantt" && (layout ?? "").trim().toLowerCase() === "calendar") return GANTT_CALENDAR_KEYS;
  return CHART_BUILDER_TARGETS[target].keys;
}
