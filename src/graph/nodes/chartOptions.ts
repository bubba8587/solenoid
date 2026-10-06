// [[C96]] chartOptionsAreMatplotlib
import type { ChartValueOp } from "../chartValue";
import { normalizeCmap } from "../colormaps";
import { isNumberSpec } from "../numberSpec";

export type ChartOp =
  | "column" | "bar" | "line" | "area" | "lollipop"
  | "pie" | "radar" | "radialbar" | "funnel" | "rose" | "scatter" | "xyline"
  | "bubble" | "hexbin" | "density";

export const CHART_OP_META = {
  column:    { label: "Column",   group: "Cartesian" },
  bar:       { label: "Bar",      group: "Cartesian" },
  line:      { label: "Line",     group: "Cartesian" },
  area:      { label: "Area",     group: "Cartesian" },
  lollipop:  { label: "Lollipop", group: "Cartesian" },
  scatter:   { label: "Scatter",  group: "XY" },
  xyline:    { label: "XY Line",  group: "XY" },
  bubble:    { label: "Bubble",   group: "XY" },
  hexbin:    { label: "Hexbin",   group: "XY" },
  density:   { label: "Density",  group: "XY" },
  pie:       { label: "Pie",      group: "Categorical" },
  radar:     { label: "Radar",    group: "Categorical" },
  radialbar: { label: "Radial",   group: "Categorical" },
  funnel:    { label: "Funnel",   group: "Categorical" },
  rose:      { label: "Rose",     group: "Categorical" },
} satisfies Record<ChartOp, { label: string; group: string }>;

export interface ChartOptions {
  kind?: ChartOp;
  title?: string;
  xlabel?: string;
  ylabel?: string;
  color?: string;
  grid?: boolean;
  marker?: boolean;
  ymin?: number;
  ymax?: number;
  xmin?: number;
  xmax?: number;
  aspect?: AspectMode;
  linestyle?: LineStyle;
  linewidth?: number;
  markersize?: number;
  alpha?: number;
  fontsize?: number;
  pielabels?: PieLabelMode;
  radarscale?: RadarScale;
  stacked?: StackMode;
  drawstyle?: DrawStyle;
  hole?: number;
  gridsize?: number;
  x?: string;
  y?: string[];
  s?: string;
  c?: string;
  annotate?: string;
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

export type HeatOrigin = "upper" | "lower";
export type LineStyle = "solid" | "dashed" | "dotted" | "dashdot" | "none";
export type AspectMode = "auto" | "equal";
export type PieLabelMode = "off" | "outside" | "inside";
export type RadarScale = "axis" | "shared";
export type StackMode = "off" | "on" | "percent";
export type DrawStyle = "default" | "steps";

const TRUTHY = new Set(["on", "true", "1", "yes", "y"]);
const FALSY = new Set(["off", "false", "0", "no", "n"]);

function toBool(v: string): boolean | undefined {
  const s = v.trim().toLowerCase();
  if (TRUTHY.has(s)) return true;
  if (FALSY.has(s)) return false;
  return undefined;
}

function toPieLabelMode(v: string): PieLabelMode | undefined {
  const s = v.trim().toLowerCase();
  if (s === "inside" || s === "center" || s === "on-chart") return "inside";
  if (s === "outside" || s === "leader") return "outside";
  const b = toBool(s);
  return b === undefined ? undefined : b ? "outside" : "off";
}

function toRadarScale(v: string): RadarScale | undefined {
  const s = v.trim().toLowerCase();
  if (s === "axis" || s === "normalize" || s === "normalized" || s === "independent") return "axis";
  if (s === "shared" || s === "raw" || s === "absolute") return "shared";
  return undefined;
}

function toStackMode(v: string): StackMode | undefined {
  const s = v.trim().toLowerCase();
  if (s === "percent" || s === "%" || s === "100%" || s === "normalize" || s === "normalized") return "percent";
  const b = toBool(s);
  return b === undefined ? undefined : b ? "on" : "off";
}

// matplotlib's step styles all draw as a step that holds each value until the next point.
function toDrawStyle(v: string): DrawStyle | undefined {
  const s = v.trim().toLowerCase();
  if (s === "default") return "default";
  if (s === "steps" || s === "steps-post" || s === "steps-pre" || s === "steps-mid") return "steps";
  return undefined;
}

function toLineStyle(v: string): LineStyle | undefined {
  const s = v.trim().toLowerCase();
  if (s === "-" || s === "solid") return "solid";
  if (s === "--" || s === "dashed") return "dashed";
  if (s === ":" || s === "dotted") return "dotted";
  if (s === "-." || s === "dashdot") return "dashdot";
  if (s === "none") return "none";
  return undefined;
}

function toAspect(v: string): AspectMode | undefined {
  const s = v.trim().toLowerCase();
  return s === "equal" || s === "auto" ? s : undefined;
}

// The Chart's own type names, any case and spacing; pandas' barh is our horizontal bar.
function toChartKind(v: string): ChartOp | undefined {
  const s = v.trim().toLowerCase().replace(/[\s_-]/g, "");
  if (s === "barh") return "bar";
  return (Object.keys(CHART_OP_META) as ChartOp[])
    .find((op) => op === s || CHART_OP_META[op].label.toLowerCase().replace(/\s/g, "") === s);
}

function toNum(v: string): number | undefined {
  const t = v.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

export function parseChartOptions(input: string | null | undefined): ChartOptions {
  const opts: ChartOptions = {};
  if (!input) return opts;
  for (const part of input.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    const val = part.slice(eq + 1).trim();
    switch (key) {
      case "kind":   { const k = toChartKind(val); if (k !== undefined) opts.kind = k; break; }
      case "title":  if (val) opts.title = val; break;
      case "xlabel": if (val) opts.xlabel = val; break;
      case "ylabel": if (val) opts.ylabel = val; break;
      case "color":  if (val) opts.color = val; break;
      case "grid":   { const b = toBool(val); if (b !== undefined) opts.grid = b; break; }
      case "marker": { const b = toBool(val); if (b !== undefined) opts.marker = b; break; }
      case "pielabels": { const m = toPieLabelMode(val); if (m !== undefined) opts.pielabels = m; break; }
      case "radarscale": { const m = toRadarScale(val); if (m !== undefined) opts.radarscale = m; break; }
      case "stacked": { const m = toStackMode(val); if (m !== undefined) opts.stacked = m; break; }
      case "drawstyle":
      case "ds":     { const m = toDrawStyle(val); if (m !== undefined) opts.drawstyle = m; break; }
      case "hole":   { const n = toNum(val); if (n !== undefined && n >= 0 && n < 1) opts.hole = n; break; }
      case "gridsize": { const n = toNum(val); if (n !== undefined && n >= 1) opts.gridsize = Math.round(n); break; }
      case "linewidth":
      case "lw":     { const n = toNum(val); if (n !== undefined) opts.linewidth = n; break; }
      case "markersize":
      case "ms":     { const n = toNum(val); if (n !== undefined && n > 0) opts.markersize = n; break; }
      case "alpha":  { const n = toNum(val); if (n !== undefined) opts.alpha = n; break; }
      case "fontsize": { const n = toNum(val); if (n !== undefined && n > 0) opts.fontsize = n; break; }
      case "ylim": {
        const [lo, hi] = val.split(",");
        const a = toNum(lo ?? "");
        const b = toNum(hi ?? "");
        if (a !== undefined) opts.ymin = a;
        if (b !== undefined) opts.ymax = b;
        break;
      }
      case "ymin":   { const n = toNum(val); if (n !== undefined) opts.ymin = n; break; }
      case "ymax":   { const n = toNum(val); if (n !== undefined) opts.ymax = n; break; }
      case "xlim": {
        const [lo, hi] = val.split(",");
        const a = toNum(lo ?? "");
        const b = toNum(hi ?? "");
        if (a !== undefined) opts.xmin = a;
        if (b !== undefined) opts.xmax = b;
        break;
      }
      case "xmin":   { const n = toNum(val); if (n !== undefined) opts.xmin = n; break; }
      case "xmax":   { const n = toNum(val); if (n !== undefined) opts.xmax = n; break; }
      case "aspect": { const m = toAspect(val); if (m !== undefined) opts.aspect = m; break; }
      case "linestyle":
      case "ls":     { const m = toLineStyle(val); if (m !== undefined) opts.linestyle = m; break; }
      case "x":      if (val) opts.x = val; break;
      case "y":      { const names = val.split(",").map((t) => t.trim()).filter(Boolean); if (names.length) opts.y = names; break; }
      case "s":      if (val) opts.s = val; break;
      case "c":      if (val) opts.c = val; break;
      case "annotate": if (val) opts.annotate = val; break;
      case "by":     if (val) opts.by = val; break;
      case "cmap":   { const m = normalizeCmap(val); if (m !== undefined) opts.cmap = m; break; }
      case "vmin":   { const n = toNum(val); if (n !== undefined) opts.vmin = n; break; }
      case "vmax":   { const n = toNum(val); if (n !== undefined) opts.vmax = n; break; }
      case "center": { const n = toNum(val); if (n !== undefined) opts.center = n; break; }
      case "annot":  { const b = toBool(val); if (b !== undefined) opts.annot = b; break; }
      case "fmt":    if (isNumberSpec(val)) opts.fmt = val; break;
      case "cbar":   { const b = toBool(val); if (b !== undefined) opts.cbar = b; break; }
      case "origin": { const s = val.toLowerCase(); if (s === "upper" || s === "lower") opts.origin = s; break; }
      default: break;
    }
  }
  return opts;
}

export interface ChartBuilderFields {
  kind?: string;
  stacked?: string;
  drawstyle?: string;
  hole?: number | null;
  gridsize?: number | null;
  title?: string;
  xlabel?: string;
  ylabel?: string;
  color?: string;
  grid?: string;
  marker?: string;
  pielabels?: string;
  radarscale?: string;
  zoom?: string;
  layout?: string;
  tiers?: string;
  fit?: string;
  critical?: string;
  baseline?: string;
  arrows?: string;
  today?: string;
  weekends?: string;
  labels?: string;
  histogram?: string;
  minutes?: string;
  window?: string;
  columns?: string;
  collapse?: string;
  week?: string;
  fiscal_start?: string;
  status?: string;
  group_by?: string;
  cardsize?: string;
  clamp?: string;
  x?: string;
  y?: string;
  s?: string;
  c?: string;
  annotate?: string;
  by?: string;
  linestyle?: string;
  aspect?: string;
  cmap?: string;
  annot?: string;
  fmt?: string;
  cbar?: string;
  origin?: string;
  xmin?: number | null;
  xmax?: number | null;
  ymin?: number | null;
  ymax?: number | null;
  linewidth?: number | null;
  markersize?: number | null;
  alpha?: number | null;
  fontsize?: number | null;
  vmin?: number | null;
  vmax?: number | null;
  center?: number | null;
}

export function serializeChartOptions(f: ChartBuilderFields): string {
  const parts: string[] = [];
  const str = (k: string, v: string | undefined) => {
    if (v != null && v.trim() !== "") parts.push(`${k}=${v.trim()}`);
  };
  const num = (k: string, v: number | null | undefined) => {
    if (v != null && Number.isFinite(v)) parts.push(`${k}=${v}`);
  };
  str("kind", f.kind);
  str("title", f.title);
  str("xlabel", f.xlabel);
  str("ylabel", f.ylabel);
  str("color", f.color);
  str("grid", f.grid);
  str("marker", f.marker);
  str("pielabels", f.pielabels);
  str("radarscale", f.radarscale);
  str("stacked", f.stacked);
  str("drawstyle", f.drawstyle);
  str("zoom", f.zoom);
  str("layout", f.layout);
  str("tiers", f.tiers);
  str("fit", f.fit);
  str("critical", f.critical);
  str("baseline", f.baseline);
  str("arrows", f.arrows);
  str("today", f.today);
  str("weekends", f.weekends);
  str("labels", f.labels);
  str("histogram", f.histogram);
  str("minutes", f.minutes);
  str("window", f.window);
  str("columns", f.columns);
  str("collapse", f.collapse);
  str("week", f.week);
  str("fiscal_start", f.fiscal_start);
  str("status", f.status);
  str("group_by", f.group_by);
  str("cardsize", f.cardsize);
  str("clamp", f.clamp);
  str("x", f.x);
  str("y", f.y);
  str("s", f.s);
  str("c", f.c);
  str("annotate", f.annotate);
  str("by", f.by);
  str("linestyle", f.linestyle);
  str("aspect", f.aspect);
  str("cmap", f.cmap);
  str("annot", f.annot);
  str("fmt", f.fmt);
  str("cbar", f.cbar);
  str("origin", f.origin);
  if ((f.xmin != null && Number.isFinite(f.xmin)) || (f.xmax != null && Number.isFinite(f.xmax))) {
    const lo = f.xmin != null && Number.isFinite(f.xmin) ? f.xmin : "";
    const hi = f.xmax != null && Number.isFinite(f.xmax) ? f.xmax : "";
    parts.push(`xlim=${lo},${hi}`);
  }
  if ((f.ymin != null && Number.isFinite(f.ymin)) || (f.ymax != null && Number.isFinite(f.ymax))) {
    const lo = f.ymin != null && Number.isFinite(f.ymin) ? f.ymin : "";
    const hi = f.ymax != null && Number.isFinite(f.ymax) ? f.ymax : "";
    parts.push(`ylim=${lo},${hi}`);
  }
  num("linewidth", f.linewidth);
  num("markersize", f.markersize);
  num("alpha", f.alpha);
  num("hole", f.hole);
  num("gridsize", f.gridsize);
  num("fontsize", f.fontsize);
  num("vmin", f.vmin);
  num("vmax", f.vmax);
  num("center", f.center);
  return parts.join(";");
}

// Update these key lists whenever a renderer learns or drops an option.

export type ChartBuilderKey =
  | "title" | "xlabel" | "ylabel" | "color" | "grid" | "marker" | "pielabels" | "radarscale" | "stacked" | "drawstyle" | "hole" | "gridsize" | "zoom"
  | "layout" | "tiers" | "fit" | "critical" | "baseline" | "arrows" | "today" | "weekends" | "labels" | "histogram" | "minutes" | "window" | "columns"
  | "collapse" | "week" | "fiscal_start" | "status" | "group_by"
  | "cardsize" | "clamp"
  | "x" | "y" | "s" | "c" | "annotate" | "by" | "linestyle" | "aspect" | "xmin" | "xmax"
  | "ymin" | "ymax" | "linewidth" | "markersize" | "alpha" | "fontsize"
  | "cmap" | "vmin" | "vmax" | "center" | "annot" | "fmt" | "cbar" | "origin";

export type ChartTargetId =
  | "column" | "bar" | "line" | "area" | "scatter" | "xyline"
  | "pie" | "radar" | "radialbar" | "funnel" | "rose"
  | "bubble" | "hexbin" | "density" | "lollipop" | "overlay"
  | "histogram" | "histogram2d" | "kpi" | "scale" | "proportion" | "sankey"
  | "waterfall" | "candle" | "boxplot" | "calheat" | "heatmap" | "contour" | "surface" | "quiver" | "gantt" | "record";

const XY_KEYS: readonly ChartBuilderKey[] =
  ["title", "xlabel", "ylabel", "color", "grid", "ymin", "ymax", "alpha", "fontsize"];
const BAR_KEYS: readonly ChartBuilderKey[] = [...XY_KEYS, "stacked"];
const LINE_KEYS: readonly ChartBuilderKey[] =
  ["title", "xlabel", "ylabel", "color", "grid", "marker", "drawstyle", "ymin", "ymax", "linewidth", "markersize", "alpha", "fontsize"];
const AREA_KEYS: readonly ChartBuilderKey[] = [...LINE_KEYS, "stacked"];
const LOLLIPOP_KEYS: readonly ChartBuilderKey[] =
  ["title", "xlabel", "ylabel", "color", "grid", "ymin", "ymax", "linewidth", "markersize", "alpha", "fontsize"];
const HEXBIN_KEYS: readonly ChartBuilderKey[] =
  ["title", "xlabel", "ylabel", "grid", "x", "y", "gridsize", "cmap", "xmin", "xmax", "ymin", "ymax", "fontsize"];
const DENSITY_KEYS: readonly ChartBuilderKey[] =
  ["title", "xlabel", "ylabel", "color", "grid", "x", "y", "by", "xmin", "xmax", "ymin", "ymax", "linewidth", "alpha", "fontsize"];
const ROSE_KEYS: readonly ChartBuilderKey[] = ["title", "grid", "fontsize"];
const SCATTER_KEYS: readonly ChartBuilderKey[] =
  ["title", "xlabel", "ylabel", "color", "grid", "x", "y", "s", "c", "cmap", "annotate", "by", "linestyle", "aspect",
    "xmin", "xmax", "ymin", "ymax", "linewidth", "markersize", "alpha", "fontsize"];
const XYLINE_KEYS: readonly ChartBuilderKey[] = [...SCATTER_KEYS, "marker"];
const PIE_KEYS: readonly ChartBuilderKey[] = ["title", "fontsize", "pielabels", "hole"];
const RADAR_KEYS: readonly ChartBuilderKey[] =
  ["title", "grid", "marker", "radarscale", "ymin", "ymax", "linewidth", "markersize", "alpha", "fontsize"];
const SLICE_KEYS: readonly ChartBuilderKey[] = ["title", "fontsize"];
const OVERLAY_KEYS: readonly ChartBuilderKey[] =
  ["title", "xlabel", "ylabel", "grid", "aspect", "xmin", "xmax", "ymin", "ymax", "linewidth", "fontsize"];
const STAT_KEYS: readonly ChartBuilderKey[] = ["title", "fontsize"];
const GANTT_TIMELINE_KEYS: readonly ChartBuilderKey[] =
  ["title", "fontsize", "zoom", "tiers", "layout", "fit", "critical", "baseline", "arrows", "today", "status", "weekends", "labels", "histogram", "minutes", "window", "columns", "collapse", "group_by", "week", "fiscal_start"];
const GANTT_CALENDAR_KEYS: readonly ChartBuilderKey[] =
  ["title", "fontsize", "layout", "critical", "minutes", "window", "week"];
const RECORD_KEYS: readonly ChartBuilderKey[] =
  ["title", "fontsize", "cardsize", "clamp"];
const CALHEAT_KEYS: readonly ChartBuilderKey[] = ["title", "cmap", "center", "vmin", "vmax", "cbar", "fontsize"];
const CONTOUR_KEYS: readonly ChartBuilderKey[] = ["title", "xlabel", "ylabel", "cmap", "center", "vmin", "vmax", "cbar", "fontsize"];
const FIELD_KEYS: readonly ChartBuilderKey[] = ["title", "cmap", "fontsize"];
const HEATMAP_KEYS: readonly ChartBuilderKey[] =
  ["title", "xlabel", "ylabel", "cmap", "center", "vmin", "vmax", "annot", "fmt", "cbar", "aspect", "origin", "fontsize"];

export const CHART_BUILDER_TARGETS: Record<ChartTargetId, { label: string; group: string; op: ChartValueOp; keys: readonly ChartBuilderKey[] }> = {
  column:    { label: "Column",           group: "Cartesian",    op: "column", keys: BAR_KEYS },
  bar:       { label: "Bar",              group: "Cartesian",    op: "bar", keys: BAR_KEYS },
  line:      { label: "Line",             group: "Cartesian",    op: "line", keys: LINE_KEYS },
  area:      { label: "Area",             group: "Cartesian",    op: "area", keys: AREA_KEYS },
  lollipop:  { label: "Lollipop",         group: "Cartesian",    op: "lollipop", keys: LOLLIPOP_KEYS },
  overlay:   { label: "Merge Plots",      group: "Cartesian",    op: "overlay", keys: OVERLAY_KEYS },
  scatter:   { label: "Scatter",          group: "XY",           op: "scatter", keys: SCATTER_KEYS },
  xyline:    { label: "XY Line",          group: "XY",           op: "xyline", keys: XYLINE_KEYS },
  bubble:    { label: "Bubble",           group: "XY",           op: "bubble", keys: SCATTER_KEYS },
  hexbin:    { label: "Hexbin",           group: "XY",           op: "hexbin", keys: HEXBIN_KEYS },
  density:   { label: "Density",          group: "XY",           op: "density", keys: DENSITY_KEYS },
  pie:       { label: "Pie",              group: "Categorical",  op: "pie", keys: PIE_KEYS },
  radar:     { label: "Radar",            group: "Categorical",  op: "radar", keys: RADAR_KEYS },
  radialbar: { label: "Radial",           group: "Categorical",  op: "radialbar", keys: SLICE_KEYS },
  funnel:    { label: "Funnel",           group: "Categorical",  op: "funnel", keys: SLICE_KEYS },
  rose:      { label: "Rose",             group: "Categorical",  op: "rose", keys: ROSE_KEYS },
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
  gantt:     { label: "Gantt",            group: "Figures",      op: "gantt", keys: GANTT_TIMELINE_KEYS },
  record:    { label: "Record",           group: "Figures",      op: "record", keys: RECORD_KEYS },
};

export const CHART_TARGET_LIST = (Object.keys(CHART_BUILDER_TARGETS) as ChartTargetId[])
  .map((id) => ({ id, ...CHART_BUILDER_TARGETS[id] }));

export function chartBuilderKeys(target: ChartTargetId, layout: string | undefined): readonly ChartBuilderKey[] {
  if (target === "gantt" && (layout ?? "").trim().toLowerCase() === "calendar") return GANTT_CALENDAR_KEYS;
  return CHART_BUILDER_TARGETS[target].keys;
}
