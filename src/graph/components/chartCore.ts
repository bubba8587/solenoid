// [[C100]] chartIsAValue, [[B2]] webTryDesktopFull
// Must stay recharts-free: a helper imported from here must not drag recharts into the main bundle.
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

// recharts writes colors as SVG attributes, where CSS var() doesn't resolve.
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
export function compactTick(n: number): string {
  if (!Number.isFinite(n)) return "";
  const r = Number(n.toPrecision(3));
  const a = Math.abs(r);
  if (a >= 1e12) return `${sig3(r / 1e12)}T`;
  if (a >= 1e9) return `${sig3(r / 1e9)}B`;
  if (a >= 1e6) return `${sig3(r / 1e6)}M`;
  if (a >= 1e3) return `${sig3(r / 1e3)}K`;
  return sig3(r);
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

/** A value axis's gutter in px: its widest compact tick at 5.8 · fs a character (never under three), measured over
 *  the data's extremes rounded to two figures (recharts' nice ends) and the round ticks between them, since a 0–1
 *  axis's 0.25 is wider than either end. Plus recharts' 8 px of tick spacing and 14 for an axis title. */
export function valueAxisWidth(values: Iterable<unknown>, fs: number, titled = false): number {
  let lo = 0, hi = 0;
  for (const v of values) {
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const ends = [lo, hi].map((n) => Number(n.toPrecision(2)));
  const ticks = [...ends, ...niceTicks(ends[0], ends[1], 4)];
  return Math.ceil(Math.max(3, ...ticks.map((n) => compactTick(n).length)) * 5.8 * fs + 8) + (titled ? 14 : 0);
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
