// Chart options vocabulary — matplotlib's pyplot kwarg names, not ours.
//
// The Chart Builder node emits, and the Chart node reads, a flat
// `key=value;key=value` string using matplotlib's well-known parameter names
// (title / xlabel / ylabel / color / grid / marker / linewidth / alpha / ylim).
// Borrowing an established, documented vocabulary keeps the option set legible
// to anyone who has touched a plotting library and avoids inventing a private
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
  // matplotlib's font.size rcParam: points, default 10 = the built-in sizes.
  // Render surfaces scale every text size by fontsize/10.
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

/**
 * Parse a matplotlib-style `key=value;…` options string into a `ChartOptions`.
 * Tolerant: whitespace is trimmed, keys are case-insensitive, booleans accept
 * on/off/true/false/1/0, `ylim=min,max` splits into ymin/ymax (and a bare side
 * like `ylim=,100` sets only that bound), and unrecognised keys are skipped.
 */
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

/**
 * Build the `key=value;…` string the Chart Builder outputs. Only set fields are
 * emitted (so an untouched builder yields ""), and the two Y bounds collapse
 * into matplotlib's single `ylim=min,max`.
 */
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
