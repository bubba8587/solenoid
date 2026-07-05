// recharts-free chart helpers. Kept OUT of chartView/chartRender so importing a
// colour resolver or a series coercion doesn't drag recharts (~heavy) into the main
// bundle — recharts lives only in the lazily-loaded chartRender.tsx chunk.
import { useSyncExternalStore } from "react";
import { appThemeStore } from "../appTheme";
import { resolveColor, type PaletteSlot } from "../palette";

export const VIZ = "#e9b63a"; // the "display" kind accent

// The chart types the shared ChartView renders. The single-series ones
// (line/area/bar/column + the categorical/polar set below) all read the flat
// `{i,v}[]` series `toSeries` produces; they differ only in the recharts shape.
export type ChartShape =
  | "line" | "area" | "bar" | "column"       // cartesian (axes-aware)
  | "pie" | "radar" | "radialbar" | "funnel" // categorical / polar
  | "scatter";                                // index-vs-value dot plot

// The categorical set for pie slices / multi-series — the SAME palette-slot order
// MermaidView uses (leads with the vivid families, gray last), so a chart and a
// wired-alongside diagram colour their series identically, and a palette switch
// re-colours both. Resolved through the ACTIVE palette at render time.
const SERIES_SLOTS: PaletteSlot[] = [
  "blue", "gold", "teal", "pink", "green", "purple",
  "sky", "vermilion", "lime", "violet", "amber", "gray",
];

// recharts sets colours as SVG attributes, where CSS var() doesn't resolve — so
// read the theme's resolved values and re-read when the theme flips. (Tooltip is
// a div, so it can use var() directly.)
export function useChartColors() {
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const cs = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    grid: get("--border-strong", "#3a3a3a"),
    axis: get("--text-dim", "#888"),
    track: get("--border-subtle", "#2a2a2a"),
  };
}

/** The resolved categorical palette (12 hues), re-read when the theme/palette
 *  flips (appThemeStore also bumps on a palette switch). Index with `i % 12`. */
export function useSeriesColors(): string[] {
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  return SERIES_SLOTS.map((slot) => resolveColor(slot));
}

/** Coerce a pass-through value to a clean numeric series for plotting. */
export function toSeries(v: number | number[] | null): { i: number; v: number }[] {
  if (v === null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr
    .map((x, i) => ({ i, v: x }))
    .filter((d) => typeof d.v === "number" && Number.isFinite(d.v));
}
