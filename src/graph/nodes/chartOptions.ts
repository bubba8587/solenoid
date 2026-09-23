// [[C96]] chartOptionsAreMatplotlib

export interface ChartOptions {
  title?: string;
  xlabel?: string;
  ylabel?: string;
  color?: string;
  grid?: boolean;
  marker?: boolean;
  ymin?: number;
  ymax?: number;
  linewidth?: number;
  markersize?: number;
  alpha?: number;
  fontsize?: number;
  pielabels?: PieLabelMode;
  radarscale?: RadarScale;
}

export type PieLabelMode = "off" | "outside" | "inside";
export type RadarScale = "axis" | "shared";

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
      case "title":  if (val) opts.title = val; break;
      case "xlabel": if (val) opts.xlabel = val; break;
      case "ylabel": if (val) opts.ylabel = val; break;
      case "color":  if (val) opts.color = val; break;
      case "grid":   { const b = toBool(val); if (b !== undefined) opts.grid = b; break; }
      case "marker": { const b = toBool(val); if (b !== undefined) opts.marker = b; break; }
      case "pielabels": { const m = toPieLabelMode(val); if (m !== undefined) opts.pielabels = m; break; }
      case "radarscale": { const m = toRadarScale(val); if (m !== undefined) opts.radarscale = m; break; }
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
      default: break;
    }
  }
  return opts;
}

export interface ChartBuilderFields {
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
  cardsize?: string;
  clamp?: string;
  ymin?: number | null;
  ymax?: number | null;
  linewidth?: number | null;
  markersize?: number | null;
  alpha?: number | null;
  fontsize?: number | null;
}

export function serializeChartOptions(f: ChartBuilderFields): string {
  const parts: string[] = [];
  const str = (k: string, v: string | undefined) => {
    if (v != null && v.trim() !== "") parts.push(`${k}=${v.trim()}`);
  };
  const num = (k: string, v: number | null | undefined) => {
    if (v != null && Number.isFinite(v)) parts.push(`${k}=${v}`);
  };
  str("title", f.title);
  str("xlabel", f.xlabel);
  str("ylabel", f.ylabel);
  str("color", f.color);
  str("grid", f.grid);
  str("marker", f.marker);
  str("pielabels", f.pielabels);
  str("radarscale", f.radarscale);
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
  str("cardsize", f.cardsize);
  str("clamp", f.clamp);
  if ((f.ymin != null && Number.isFinite(f.ymin)) || (f.ymax != null && Number.isFinite(f.ymax))) {
    const lo = f.ymin != null && Number.isFinite(f.ymin) ? f.ymin : "";
    const hi = f.ymax != null && Number.isFinite(f.ymax) ? f.ymax : "";
    parts.push(`ylim=${lo},${hi}`);
  }
  num("linewidth", f.linewidth);
  num("markersize", f.markersize);
  num("alpha", f.alpha);
  num("fontsize", f.fontsize);
  return parts.join(";");
}

// Update these key lists whenever a renderer learns or drops an option.

export type ChartBuilderKey =
  | "title" | "xlabel" | "ylabel" | "color" | "grid" | "marker" | "pielabels" | "radarscale" | "zoom"
  | "layout" | "tiers" | "fit" | "critical" | "baseline" | "arrows" | "today" | "weekends" | "labels" | "histogram" | "minutes" | "window" | "columns"
  | "cardsize" | "clamp"
  | "ymin" | "ymax" | "linewidth" | "markersize" | "alpha" | "fontsize";

export type ChartTargetId =
  | "column" | "bar" | "line" | "area" | "scatter"
  | "pie" | "radar" | "radialbar" | "funnel"
  | "composed" | "bubble"
  | "histogram" | "kpi" | "scale" | "proportion" | "sankey"
  | "waterfall" | "candle" | "boxplot" | "calheat" | "gantt" | "record";

const XY_KEYS: readonly ChartBuilderKey[] =
  ["title", "xlabel", "ylabel", "color", "grid", "ymin", "ymax", "alpha", "fontsize"];
const LINE_KEYS: readonly ChartBuilderKey[] =
  ["title", "xlabel", "ylabel", "color", "grid", "marker", "ymin", "ymax", "linewidth", "markersize", "alpha", "fontsize"];
const SCATTER_KEYS: readonly ChartBuilderKey[] =
  ["title", "xlabel", "ylabel", "color", "grid", "ymin", "ymax", "markersize", "alpha", "fontsize"];
const PIE_KEYS: readonly ChartBuilderKey[] = ["title", "fontsize", "pielabels"];
const RADAR_KEYS: readonly ChartBuilderKey[] = ["title", "grid", "radarscale", "fontsize"];
const SLICE_KEYS: readonly ChartBuilderKey[] = ["title", "fontsize"];
const COMPOSED_KEYS: readonly ChartBuilderKey[] =
  ["title", "xlabel", "ylabel", "grid", "marker", "ymin", "ymax", "linewidth", "markersize", "alpha", "fontsize"];
const BUBBLE_KEYS: readonly ChartBuilderKey[] = ["title", "xlabel", "ylabel", "grid", "ymin", "ymax", "fontsize"];
const AXED_KEYS: readonly ChartBuilderKey[] =
  ["title", "xlabel", "ylabel", "color", "grid", "ymin", "ymax", "alpha", "fontsize"];
const STAT_KEYS: readonly ChartBuilderKey[] = ["title", "fontsize"];
const TITLE_ONLY: readonly ChartBuilderKey[] = ["title"];
const GANTT_TIMELINE_KEYS: readonly ChartBuilderKey[] =
  ["title", "fontsize", "zoom", "tiers", "layout", "fit", "critical", "baseline", "arrows", "today", "weekends", "labels", "histogram", "minutes", "window", "columns"];
const GANTT_CALENDAR_KEYS: readonly ChartBuilderKey[] =
  ["title", "fontsize", "layout", "critical", "minutes", "window"];
const RECORD_KEYS: readonly ChartBuilderKey[] =
  ["title", "fontsize", "cardsize", "clamp"];

export const CHART_BUILDER_TARGETS: Record<ChartTargetId, { label: string; group: string; keys: readonly ChartBuilderKey[] }> = {
  column:    { label: "Column",           group: "Cartesian",    keys: XY_KEYS },
  bar:       { label: "Bar",              group: "Cartesian",    keys: XY_KEYS },
  line:      { label: "Line",             group: "Cartesian",    keys: LINE_KEYS },
  area:      { label: "Area",             group: "Cartesian",    keys: LINE_KEYS },
  scatter:   { label: "Scatter",          group: "Cartesian",    keys: SCATTER_KEYS },
  pie:       { label: "Pie",              group: "Categorical",  keys: PIE_KEYS },
  radar:     { label: "Radar",            group: "Categorical",  keys: RADAR_KEYS },
  radialbar: { label: "Radial",           group: "Categorical",  keys: SLICE_KEYS },
  funnel:    { label: "Funnel",           group: "Categorical",  keys: SLICE_KEYS },
  composed:  { label: "Composed",         group: "Multi-series", keys: COMPOSED_KEYS },
  bubble:    { label: "Bubble",           group: "Multi-series", keys: BUBBLE_KEYS },
  histogram: { label: "Histogram",        group: "Figures",      keys: AXED_KEYS },
  kpi:       { label: "KPI",              group: "Figures",      keys: STAT_KEYS },
  scale:     { label: "Gauge",            group: "Figures",      keys: STAT_KEYS },
  proportion: { label: "Proportion",      group: "Figures",      keys: STAT_KEYS },
  sankey:    { label: "Sankey",           group: "Figures",      keys: STAT_KEYS },
  waterfall: { label: "Waterfall",        group: "Figures",      keys: TITLE_ONLY },
  candle:    { label: "Candlestick",      group: "Figures",      keys: TITLE_ONLY },
  boxplot:   { label: "Boxplot",          group: "Figures",      keys: TITLE_ONLY },
  calheat:   { label: "Calendar Heatmap", group: "Figures",      keys: TITLE_ONLY },
  gantt:     { label: "Gantt",            group: "Figures",      keys: GANTT_TIMELINE_KEYS },
  record:    { label: "Record",           group: "Figures",      keys: RECORD_KEYS },
};

export const CHART_TARGET_LIST = (Object.keys(CHART_BUILDER_TARGETS) as ChartTargetId[])
  .map((id) => ({ id, ...CHART_BUILDER_TARGETS[id] }));

export function chartBuilderKeys(target: ChartTargetId, layout: string | undefined): readonly ChartBuilderKey[] {
  if (target === "gantt" && (layout ?? "").trim().toLowerCase() === "calendar") return GANTT_CALENDAR_KEYS;
  return CHART_BUILDER_TARGETS[target].keys;
}
