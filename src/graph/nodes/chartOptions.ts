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
  alpha?: number;
  // matplotlib's font.size rcParam; render surfaces scale every text size by fontsize/10.
  fontsize?: number;
}

const TRUTHY = new Set(["on", "true", "1", "yes", "y"]);
const FALSY = new Set(["off", "false", "0", "no", "n"]);

function toBool(v: string): boolean | undefined {
  const s = v.trim().toLowerCase();
  if (TRUTHY.has(s)) return true;
  if (FALSY.has(s)) return false;
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
      case "linewidth":
      case "lw":     { const n = toNum(val); if (n !== undefined) opts.linewidth = n; break; }
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
  ymin?: number | null;
  ymax?: number | null;
  linewidth?: number | null;
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
  if ((f.ymin != null && Number.isFinite(f.ymin)) || (f.ymax != null && Number.isFinite(f.ymax))) {
    const lo = f.ymin != null && Number.isFinite(f.ymin) ? f.ymin : "";
    const hi = f.ymax != null && Number.isFinite(f.ymax) ? f.ymax : "";
    parts.push(`ylim=${lo},${hi}`);
  }
  num("linewidth", f.linewidth);
  num("alpha", f.alpha);
  num("fontsize", f.fontsize);
  return parts.join(";");
}

// Which option keys each figure's RENDERER actually reads; keep in sync with the render
// layer when a view learns an option. The builder still SERIALIZES every set field — an
// unread key is inert, and one builder may feed several charts.
//   • ChartView (the Chart node, any shape) reads everything; its column/bar
//     path skips marker/linewidth but the Chart node can be a line, so the
//     "chart" target keeps the full set.
//   • Histogram renders through ChartView as columns → no marker/linewidth.
//   • The payload figures (KPI / Bullet / Treemap / Sankey) fold fontsize into
//     their text scale; title flows to the figure title everywhere.
//   • The canvas figures (Waterfall / Candlestick / Boxplot / Calendar
//     Heatmap / Waffle) read nothing but the title.

export type ChartBuilderKey =
  | "title" | "xlabel" | "ylabel" | "color" | "grid" | "marker"
  | "ymin" | "ymax" | "linewidth" | "alpha" | "fontsize";

export type ChartTargetId =
  | "chart" | "histogram" | "kpi" | "bullet" | "treemap" | "sankey"
  | "waterfall" | "candle" | "boxplot" | "calheat" | "waffle";

const ALL_KEYS: readonly ChartBuilderKey[] =
  ["title", "xlabel", "ylabel", "color", "grid", "marker", "ymin", "ymax", "linewidth", "alpha", "fontsize"];
const AXED_KEYS: readonly ChartBuilderKey[] =
  ["title", "xlabel", "ylabel", "color", "grid", "ymin", "ymax", "alpha", "fontsize"];
const STAT_KEYS: readonly ChartBuilderKey[] = ["title", "fontsize"];
const TITLE_ONLY: readonly ChartBuilderKey[] = ["title"];

export const CHART_BUILDER_TARGETS: Record<ChartTargetId, { label: string; keys: readonly ChartBuilderKey[] }> = {
  chart:     { label: "Chart",            keys: ALL_KEYS },
  histogram: { label: "Histogram",        keys: AXED_KEYS },
  kpi:       { label: "KPI",              keys: STAT_KEYS },
  bullet:    { label: "Bullet",           keys: STAT_KEYS },
  treemap:   { label: "Treemap",          keys: STAT_KEYS },
  sankey:    { label: "Sankey",           keys: STAT_KEYS },
  waterfall: { label: "Waterfall",        keys: TITLE_ONLY },
  candle:    { label: "Candlestick",      keys: TITLE_ONLY },
  boxplot:   { label: "Boxplot",          keys: TITLE_ONLY },
  calheat:   { label: "Calendar Heatmap", keys: TITLE_ONLY },
  waffle:    { label: "Waffle",           keys: TITLE_ONLY },
};

export const CHART_TARGET_LIST = (Object.keys(CHART_BUILDER_TARGETS) as ChartTargetId[])
  .map((id) => ({ id, ...CHART_BUILDER_TARGETS[id] }));
