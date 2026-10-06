// [[C100]] chartIsAValue, [[B2]] webTryDesktopFull
// Must stay free of the chart library: a helper imported from here must not drag it into the main bundle.
import { useState, useSyncExternalStore } from "react";
import { appThemeStore } from "../appTheme";
import { resolveColor, type PaletteSlot } from "../palette";
import { dateTrunc, dateFromParts } from "../nodes/dateOps";
import { serialToJsDate } from "../nodes/dateSerial";
import type { ChartValue } from "../chartValue";

export type ChartShape =
  | "line" | "area" | "bar" | "column" | "lollipop"     // cartesian (axes-aware)
  | "pie" | "radar" | "radialbar" | "funnel" | "rose";  // categorical / polar

// The same slot order as MermaidView, so a chart and a diagram side by side color their series alike.
const SERIES_SLOTS: PaletteSlot[] = [
  "blue", "gold", "teal", "pink", "green", "purple",
  "sky", "vermilion", "lime", "violet", "amber", "gray",
];

// Resolved values, so an exported SVG carries real colors rather than variables the note can't resolve.
export function useChartColors() {
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const cs = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    grid: get("--border-strong", "#3a3a3a"),
    axis: get("--text-dim", "#888"),
    track: get("--gauge-track", "#4d5157"),
    viz: resolveColor("gold"),
  };
}

export function useSeriesColors(): string[] {
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  return SERIES_SLOTS.map((slot) => resolveColor(slot));
}

export type SeriesSpotlight = { index: number; name: string } | null;

/** The series a legend spotlight picks out now: the picked slot while it still holds the picked name, else the one
 *  series still wearing that name, else none. */
export function spotlightIndex(focus: SeriesSpotlight, names: readonly string[]): number | null {
  if (!focus) return null;
  if (names[focus.index] === focus.name) return focus.index;
  const at = names.indexOf(focus.name);
  return at >= 0 && names.lastIndexOf(focus.name) === at ? at : null;
}

/** A legend click spotlights a series (a second click clears it); `dim(j)` is series j's opacity. */
export function useSeriesSpotlight(names: readonly string[]) {
  const [focus, setFocus] = useState<SeriesSpotlight>(null);
  const on = spotlightIndex(focus, names);
  return {
    dim: (j: number) => (on !== null && on !== j ? 0.18 : 1),
    pick: (j: number) => setFocus(on === j ? null : { index: j, name: names[j] ?? "" }),
  };
}

export function axisTick(n: number): string {
  if (!Number.isFinite(n)) return "";
  return String(Number(n.toPrecision(10)));
}

const sig3 = (n: number): string => String(Number(n.toPrecision(3)));

/** A value-axis tick: three significant figures, with K, M, B, T above a thousand. It rounds before it picks the
 *  unit, so 999,999 reads 1M, not 1000K. */
/** The app's own face, the first family of `--font-sans` or `--font-mono`: a canvas names only it, so no other face can stand in. */
function appFamily(face: "sans" | "mono"): string {
  return getComputedStyle(document.documentElement).getPropertyValue(face === "mono" ? "--font-mono" : "--font-sans").split(",")[0].trim();
}

/** A canvas font in the app's face, since a canvas can't read a CSS variable itself. */
export function canvasFont(weight: number, px: number, face: "sans" | "mono" = "sans"): string {
  return `${weight} ${px}px ${appFamily(face)}`;
}

// A canvas paints its text once, in whatever face is loaded at that moment, and the bundled faces load
// asynchronously; so the canvas figures wait for both faces, the Latin and Latin Extended glyphs included.
const FACE_SAMPLE = "0123456789 AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz .,:;%+-·…éüñçłő";
let facesReady = false;
const faceSubs = new Set<() => void>();
function subscribeFaces(cb: () => void) {
  faceSubs.add(cb);
  if (!facesReady && faceSubs.size === 1) {
    void Promise.all((["sans", "mono"] as const).map((f) => document.fonts.load(canvasFont(500, 12, f), FACE_SAMPLE)))
      .finally(() => { facesReady = true; faceSubs.forEach((f) => f()); });
  }
  return () => { faceSubs.delete(cb); };
}
/** False until the app's faces are loaded; a canvas figure paints only once it is true. */
export function useAppFaces(): boolean {
  return useSyncExternalStore(subscribeFaces, () => facesReady);
}

/** A tick in three figures with a K/M/B/T unit. Given about the axis's tick `step`, when three figures can't tell
 *  neighbours apart it writes the tick in full, to two places past the step's (100000, 100250 → 100K, 100.25K). */
export function compactTick(n: number, step?: number): string {
  if (!Number.isFinite(n)) return "";
  const r = Number(n.toPrecision(3));
  const a = Math.abs(r);
  const unit = a >= 1e12 ? 1e12 : a >= 1e9 ? 1e9 : a >= 1e6 ? 1e6 : a >= 1e3 ? 1e3 : 1;
  const suffix = unit === 1e12 ? "T" : unit === 1e9 ? "B" : unit === 1e6 ? "M" : unit === 1e3 ? "K" : "";
  if (step && step > 0 && Number.isFinite(step) && n !== 0 && step < 10 ** (Math.floor(Math.log10(Math.abs(n))) - 2)) {
    const places = (x: number, cap: number) => {
      let d = 0;
      while (d < cap && Math.abs(Math.round(x * 10 ** d) - x * 10 ** d) > 1e-6) d++;
      return d;
    };
    return `${Number((n / unit).toFixed(places(n / unit, places(step / unit, 12) + 2)))}${suffix}`;
  }
  return `${sig3(r / unit)}${suffix}`;
}

/** One value axis's tick formatter: `compactTick` at the step of the axis's ticks, or of round ticks over the
 *  values' own range when the axis picks its ticks itself. */
export function valueTickFormat(values: Iterable<unknown>, ticks?: readonly number[]): (n: number) => string {
  let step = Infinity;
  if (ticks && ticks.length > 1) for (let i = 1; i < ticks.length; i++) step = Math.min(step, Math.abs(ticks[i] - ticks[i - 1]) || Infinity);
  else {
    let lo = Infinity, hi = -Infinity;
    for (const v of values) if (typeof v === "number" && Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const t = hi > lo ? niceTicks(lo, hi, 5) : [];
    if (t.length > 1) step = t[1] - t[0];
  }
  const s = Number.isFinite(step) ? step : undefined;
  return (n: number) => compactTick(n, s);
}

/** Ticks on a date axis from serial `lo` to `hi`, about `count` of them, on the calendar boundaries DATETRUNC uses:
 *  the first of January every 1, 2, 5, 10, 20 or 50 years across three years or more, else the first of a month every
 *  1, 2, 3 or 6 months. `byYear` tells the caller to label them with the year alone. */
export function dateTicks(lo: number, hi: number, count: number): { ticks: number[]; byYear: boolean } {
  if (!(hi > lo)) return { ticks: [lo], byYear: false };
  const want = Math.max(2, count);
  const years = (hi - lo) / 365.25;
  const byYear = years >= 3;
  const steps = byYear ? [1, 2, 5, 10, 20, 50] : [1, 2, 3, 6];
  const span = byYear ? years : years * 12;
  const step = steps.find((s) => span / s <= want) ?? steps[steps.length - 1];
  const first = serialToJsDate(dateTrunc(lo, byYear ? "year" : "month", true));
  let y = first.getUTCFullYear(), m = first.getUTCMonth();
  // Align to the step so ticks land on round years (2020, 2025) or quarter and half-year starts.
  if (byYear) y = Math.ceil(y / step) * step;
  else { const k = Math.ceil((y * 12 + m) / step) * step; y = Math.floor(k / 12); m = k % 12; }
  const ticks: number[] = [];
  for (;;) {
    const t = dateFromParts(y, m + 1, 1);
    if (typeof t !== "number" || t > hi) break;
    ticks.push(t);
    if (byYear) y += step; else { m += step; y += Math.floor(m / 12); m %= 12; }
  }
  return { ticks, byYear };
}

/** How many rows a series legend takes across `width` px: each entry is an 8 px swatch, a 4 px gap and its text at
 *  about 5.4 · fs px a character, entries 10 px apart. Rows are counted ahead of drawing so the plot can give up their
 *  height without jumping, and are capped at `maxRows` so a small figure keeps its plot; entries past the cap are clipped. */
export function legendRows(names: readonly string[], width: number, fs: number, maxRows = Infinity): number {
  let rows = 1, used = 0;
  for (const n of names) {
    const w = 12 + n.length * 5.4 * fs;
    if (used > 0 && used + 10 + w > width) { rows++; used = w; }
    else used += (used > 0 ? 10 : 0) + w;
  }
  return Math.max(1, Math.min(rows, maxRows));
}

/** Log-axis ticks inside [lo, hi] (both above zero): 1, 2 and 5 of each decade, or only the 1s past four decades. */
export function logTicks(lo: number, hi: number): number[] {
  if (!(lo > 0) || !(hi >= lo)) return [];
  const steps = Math.log10(hi / lo) > 4 ? [1] : [1, 2, 5];
  const out: number[] = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++)
    for (const m of steps) { const v = Number((m * 10 ** e).toPrecision(12)); if (v >= lo && v <= hi) out.push(v); }
  return out;
}

/** Round-number ticks inside [lo, hi], about `count` of them. */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  const raw = (hi - lo) / count;
  if (!(raw > 0) || !Number.isFinite(raw)) return [lo];
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

/**
 * A line's points thinned to each of `buckets` index spans' lowest and highest point, kept in index order, so a
 * series far denser than its pixels draws the same envelope (every spike included) from 2 × `buckets` points.
 * Every span gives exactly two (a flat span repeats its point), since a category axis spaces points by count.
 */
export function minMaxDecimate<P extends { v: number }>(series: P[], buckets: number): P[] {
  const n = series.length;
  if (buckets < 1 || n <= buckets * 4) return series;
  const out: P[] = [];
  for (let b = 0; b < buckets; b++) {
    const lo = Math.floor((b * n) / buckets), hi = Math.floor(((b + 1) * n) / buckets);
    let min = lo, max = lo;
    for (let k = lo + 1; k < hi; k++) {
      if (series[k].v < series[min].v) min = k;
      if (series[k].v > series[max].v) max = k;
    }
    if (min <= max) out.push(series[min], series[max]);
    else out.push(series[max], series[min]);
  }
  return out;
}

/**
 * The rows of several index-aligned series that keep each one's envelope on `buckets` spans: every span gives each
 * series' lowest and highest row, topped up to two distinct rows per series, so every span gives the same count of
 * distinct rows and a category axis keeps its spacing. A span
 * where a series is blank gives a blank row for it, so a gap wider than a pixel stays a gap. Null when the series are
 * not dense enough to thin.
 */
export function envelopeRows(series: readonly (readonly (number | null)[])[], n: number, buckets: number): number[] | null {
  const k = series.length;
  if (buckets < 1 || k === 0 || n <= buckets * k * 4) return null;
  const out: number[] = [];
  const picks: number[] = [];
  for (let b = 0; b < buckets; b++) {
    const lo = Math.floor((b * n) / buckets), hi = Math.floor(((b + 1) * n) / buckets);
    picks.length = 0;
    for (const vals of series) {
      let min = -1, max = -1;
      for (let r = lo; r < hi; r++) {
        const v = vals[r];
        if (v == null) continue;
        if (min < 0 || v < (vals[min] as number)) min = r;
        if (max < 0 || v > (vals[max] as number)) max = r;
      }
      if (min < 0) picks.push(lo, lo);
      else picks.push(min, max);
    }
    // Distinct rows, topped up from the span's start where series share a pick, so no category repeats.
    const set = new Set(picks);
    for (let r = lo; set.size < picks.length && r < hi; r++) set.add(r);
    for (const r of [...set].sort((a, b2) => a - b2)) out.push(r);
  }
  return out;
}

/** How a run of XY points thins: a markerless line by its pixel columns, a line with markers by its consecutive
 *  pixel cells, scattered dots by every pixel cell. */
export type ThinMode = "line" | "markers" | "dots";

/**
 * An XY run without the points no one could see. `px` and `py` map a point to the pixel it lands on (fractional is
 * fine; the scale may be coarser than the axis's real one, never finer). A markerless line whose x only climbs or only
 * falls keeps each pixel column's first, lowest, highest and last point, which draws the same strokes; otherwise
 * (`markers`, or x that turns back) a streak of points in one pixel keeps its first and last. Dots keep the last point
 * in each pixel, the one drawn on top. Point order is kept.
 */
export function thinXY<P extends { x: number; y: number }>(rows: readonly P[], px: (x: number) => number, py: (y: number) => number, mode: ThinMode): P[] {
  const n = rows.length;
  if (n < 3) return rows.slice();
  const cell = (p: P) => `${Math.floor(px(p.x))},${Math.floor(py(p.y))}`;
  if (mode === "dots") {
    const seen = new Set<string>();
    const keep: P[] = [];
    for (let r = n - 1; r >= 0; r--) {
      const c = cell(rows[r]);
      if (seen.has(c)) continue;
      seen.add(c);
      keep.push(rows[r]);
    }
    return keep.reverse();
  }
  let up = true, down = true;
  for (let r = 1; r < n && (up || down); r++) {
    if (rows[r].x < rows[r - 1].x) up = false;
    if (rows[r].x > rows[r - 1].x) down = false;
  }
  const out: P[] = [];
  if (mode === "line" && (up || down)) {
    let start = 0;
    while (start < n) {
      const col = Math.floor(px(rows[start].x));
      let end = start + 1;
      while (end < n && Math.floor(px(rows[end].x)) === col) end++;
      let min = start, max = start;
      for (let r = start + 1; r < end; r++) {
        if (rows[r].y < rows[min].y) min = r;
        if (rows[r].y > rows[max].y) max = r;
      }
      const picks = [start, min, max, end - 1].sort((a, b) => a - b);
      picks.forEach((r, i) => { if (i === 0 || r !== picks[i - 1]) out.push(rows[r]); });
      start = end;
    }
    return out;
  }
  let start = 0;
  while (start < n) {
    const c = cell(rows[start]);
    let end = start + 1;
    while (end < n && cell(rows[end]) === c) end++;
    out.push(rows[start]);
    if (end - 1 > start) out.push(rows[end - 1]);
    start = end;
  }
  return out;
}

export function toSeries(v: unknown): { i: number; v: number }[] {
  if (v == null) return [];
  const arr: unknown[] = Array.isArray(v) ? v : [v];
  const out: { i: number; v: number }[] = [];
  for (let i = 0; i < arr.length; i++) {
    const x = arr[i];
    if (typeof x === "number" && Number.isFinite(x)) out.push({ i, v: x });
  }
  return out;
}

/** The rows a part-of-whole figure can place: a pie has no slice for zero or less, a funnel stage or radial ring none below zero. */
export function partSlices(op: ChartShape, series: readonly { i: number; v: number }[]): { i: number; v: number }[] {
  if (op === "pie") return series.filter((d) => d.v > 0);
  if (op === "funnel" || op === "radialbar" || op === "rose") return series.filter((d) => d.v >= 0);
  return [...series];
}

/** What a reference row draws: any second end makes an area whose missing ends run to the plot's edges (a box when
 *  both axes are bounded), an x and a y alone a point, otherwise a line across the plot. */
export function refShape(r: { x?: unknown; x2?: unknown; y?: unknown; y2?: unknown }): "area" | "point" | "vline" | "hline" | null {
  if (r.x2 !== undefined || r.y2 !== undefined) return "area";
  if (r.x !== undefined && r.y !== undefined) return "point";
  if (r.x !== undefined) return "vline";
  return r.y !== undefined ? "hline" : null;
}

/** Past this many points a figure redraws once a resize settles, stretching its last drawing until then. */
export const HEAVY_FIGURE_POINTS = 5000;

/** The points a figure draws, counted from what it holds. */
export function figurePoints(value: ChartValue): number {
  const p = value.payload;
  if (p?.kind === "xy") return p.series.reduce((m, s) => m + s.points.length, 0);
  if (p?.kind === "overlay") return p.series.reduce((m, s) => m + s.values.length, 0);
  if (value.series) return value.series.reduce((m, s) => m + s.values.length, 0);
  return Array.isArray(value.values) ? value.values.length : 0;
}

/** A label safe for a figure: control characters to spaces, whitespace collapsed, capped at `cap` code points with an ellipsis. */
export function sanitizeChartLabel(raw: string, cap = 16): string {
  let clean = "";
  for (const ch of raw) {
    const c = ch.codePointAt(0);
    clean += (c !== undefined && (c < 0x20 || (c >= 0x7f && c <= 0x9f))) ? " " : ch;
  }
  clean = clean.replace(/\s+/g, " ").trim();
  const cps = [...clean]; // code points, so the cap never splits a surrogate pair
  return cps.length > cap ? `${cps.slice(0, cap - 1).join("").trimEnd()}…` : clean;
}
