// [[C100]] chartIsAValue, [[B2]] webTryDesktopFull
// Must stay recharts-free: a helper imported from here must not drag recharts into the main bundle.
import { useSyncExternalStore } from "react";
import { appThemeStore } from "../appTheme";
import { resolveColor, type PaletteSlot } from "../palette";

export type ChartShape =
  | "line" | "area" | "bar" | "column"       // cartesian (axes-aware)
  | "pie" | "radar" | "radialbar" | "funnel" // categorical / polar
  | "scatter";                                // index-vs-value dot plot

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

export function axisTick(n: number): string {
  if (!Number.isFinite(n)) return "";
  return String(Number(n.toPrecision(10)));
}

const sig3 = (n: number): string => String(Number(n.toPrecision(3)));

/** A value-axis tick: three significant figures, with K, M, B above a thousand. */
export function compactTick(n: number): string {
  if (!Number.isFinite(n)) return "";
  const a = Math.abs(n);
  if (a >= 1e9) return `${sig3(n / 1e9)}B`;
  if (a >= 1e6) return `${sig3(n / 1e6)}M`;
  if (a >= 1e3) return `${sig3(n / 1e3)}K`;
  return sig3(n);
}

/** A value axis's gutter in px: its widest compact tick at 5.8 · fs a character (never under three), with the
 *  data's extremes rounded to two figures standing in for recharts' nice end ticks, plus recharts' 8 px of tick
 *  spacing and 14 for an axis title. */
export function valueAxisWidth(values: Iterable<unknown>, fs: number, titled = false): number {
  let lo = 0, hi = 0;
  for (const v of values) {
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const ends = [lo, hi].map((n) => compactTick(Number(n.toPrecision(2))).length);
  return Math.ceil(Math.max(3, ...ends) * 5.8 * fs + 8) + (titled ? 14 : 0);
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
