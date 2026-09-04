// A flat `key=value;…` string in matplotlib's pyplot kwarg names, deliberately not a private
// dialect. Unknown keys are ignored, so the string degrades gracefully.

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
  // marker radius in px (matplotlib's markersize)
  markersize?: number;
  alpha?: number;
  // matplotlib's font.size rcParam; render surfaces scale every text size by fontsize/10.
  fontsize?: number;
  // Pie slice category labels: outside on a leader (the default when names are present),
  // inside/on the slice with a backing plate, or off. Only ever carries an explicit choice.
  pielabels?: PieLabelMode;
  // Radar radial scale: "axis" normalizes each spoke to [0,1] by its own max so no one axis
  // (a dollar column beside /10 scores) swamps the rest, a negative plotting at the centre;
  // "shared" keeps one raw radius.
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

/** off/outside/inside, with on→outside and center→inside as friendly aliases; a bare
 *  boolean on/off still works (an old save, or a plain toggle). */
function toPieLabelMode(v: string): PieLabelMode | undefined {
  const s = v.trim().toLowerCase();
  if (s === "inside" || s === "center" || s === "on-chart") return "inside";
  if (s === "outside" || s === "leader") return "outside";
  const b = toBool(s);
  return b === undefined ? undefined : b ? "outside" : "off";
}

/** per-axis / shared, with normalize→axis and raw→shared as friendly aliases. */
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

/** Tolerant parse: whitespace trimmed, keys case-insensitive, booleans as
 *  on/off/true/false/1/0, `ylim=min,max` split into ymin/ymax (a bare side sets one
 *  bound), unrecognised keys skipped. */
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
      default: break; // unrecognised matplotlib kwarg → ignored
    }
  }
  return opts;
}

/** A resolved Chart Builder field set (wired value ?? inline literal per field). */
export interface ChartBuilderFields {
  title?: string;
  xlabel?: string;
  ylabel?: string;
  color?: string;
  grid?: string;
  marker?: string;
  pielabels?: string;
  radarscale?: string;
  ymin?: number | null;
  ymax?: number | null;
  linewidth?: number | null;
  markersize?: number | null;
  alpha?: number | null;
  fontsize?: number | null;
}

/** Only set fields are emitted, so an untouched builder yields ""; the two Y bounds
 *  collapse into matplotlib's single `ylim=min,max`. */
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

// Which option keys each figure's RENDERER actually reads; keep in sync with the render
// layer when a view learns an option. The builder still SERIALIZES every set field — an
// unread key is inert, and one builder can feed several charts, so narrowing is only which
// fields the form OFFERS.
//   • Each Chart-node op is its own target: line/area add marker + line width, pie adds
//     pielabels (and drops the axes), the categorical slices keep only title/color/font.
//   • Histogram renders through the column path → axes but no marker/line width.
//   • The payload figures (KPI / Gauge / Proportion / Sankey) fold fontsize into their
//     text scale; title flows to the figure title everywhere.
//   • The canvas figures (Waterfall / Candlestick / Boxplot / Calendar Heatmap) read
//     nothing but the title.

export type ChartBuilderKey =
  | "title" | "xlabel" | "ylabel" | "color" | "grid" | "marker" | "pielabels" | "radarscale"
  | "ymin" | "ymax" | "linewidth" | "markersize" | "alpha" | "fontsize";

// The Chart node's own ops are first-class targets so the form can show ONLY the options
// that op reads (pielabels for Pie, line width for Line, none of that for Bar); the rest are
// the standalone figure nodes. The `group` drives the target dropdown's two-level layout.
export type ChartTargetId =
  | "column" | "bar" | "line" | "area" | "scatter"
  | "pie" | "radar" | "radialbar" | "funnel"
  | "composed" | "bubble"
  | "histogram" | "kpi" | "scale" | "proportion" | "sankey"
  | "waterfall" | "candle" | "boxplot" | "calheat";

const XY_KEYS: readonly ChartBuilderKey[] =
  ["title", "xlabel", "ylabel", "color", "grid", "ymin", "ymax", "alpha", "fontsize"];
const LINE_KEYS: readonly ChartBuilderKey[] =
  ["title", "xlabel", "ylabel", "color", "grid", "marker", "ymin", "ymax", "linewidth", "markersize", "alpha", "fontsize"];
const SCATTER_KEYS: readonly ChartBuilderKey[] =
  ["title", "xlabel", "ylabel", "color", "grid", "ymin", "ymax", "markersize", "alpha", "fontsize"];
// The categorical ops (pie / radar / radial / funnel) paint from the palette — a single
// `color` is inert, so it isn't offered.
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
};

export const CHART_TARGET_LIST = (Object.keys(CHART_BUILDER_TARGETS) as ChartTargetId[])
  .map((id) => ({ id, ...CHART_BUILDER_TARGETS[id] }));
