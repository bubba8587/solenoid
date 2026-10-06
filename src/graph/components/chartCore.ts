// [[C100]] chartIsAValue, [[B2]] webTryDesktopFull
// Must stay free of the chart library: a helper imported from here must not drag it into the main bundle.
import { useState, useSyncExternalStore } from "react";
import { appThemeStore } from "../appTheme";
import { resolveColor, type PaletteSlot } from "../palette";

export type ChartShape =
  | "line" | "area" | "bar" | "column"       // cartesian (axes-aware)
  | "pie" | "radar" | "radialbar" | "funnel"; // categorical / polar

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
  if (op === "funnel" || op === "radialbar") return series.filter((d) => d.v >= 0);
  return [...series];
}
