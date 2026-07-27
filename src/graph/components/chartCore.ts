// recharts-free chart helpers. Kept OUT of chartView/chartRender so importing a
// color resolver or a series coercion doesn't drag recharts (~heavy) into the main
// bundle — recharts lives only in the lazily-loaded chartRender.tsx chunk.
import { useSyncExternalStore } from "react";
import { appThemeStore } from "../appTheme";
import { resolveColor, type PaletteSlot } from "../palette";
import { NODE_KIND_ACCENTS } from "../nodes/shared";

// The chart types the shared ChartView renders. The single-series ones
// (line/area/bar/column + the categorical/polar set below) all read the flat
// `{i,v}[]` series `toSeries` produces; they differ only in the recharts shape.
export type ChartShape =
  | "line" | "area" | "bar" | "column"       // cartesian (axes-aware)
  | "pie" | "radar" | "radialbar" | "funnel" // categorical / polar
  | "scatter";                                // index-vs-value dot plot

// The categorical set for pie slices / multi-series — the SAME palette-slot order
// MermaidView uses (leads with the vivid families, gray last), so a chart and a
// wired-alongside diagram color their series identically, and a palette switch
// re-colors both. Resolved through the ACTIVE palette at render time.
const SERIES_SLOTS: PaletteSlot[] = [
  "blue", "gold", "teal", "pink", "green", "purple",
  "sky", "vermilion", "lime", "violet", "amber", "gray",
];

// recharts sets colors as SVG attributes, where CSS var() doesn't resolve — so
// read the theme's resolved values and re-read when the theme flips. (Tooltip is
// a div, so it can use var() directly.)
export function useChartColors() {
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const cs = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    grid: get("--border-strong", "#3a3a3a"),
    axis: get("--text-dim", "#888"),
    // The Gauge's unfilled-arc track — a neutral gray tuned for clear contrast
    // against the node body in both themes (--border-subtle was near-invisible).
    track: get("--gauge-track", "#4d5157"),
    // The single-series fill (Sparkline / Chart line / the Gauge arc) — the
    // "display" node kind's accent, resolved through the ACTIVE palette (the map
    // is refreshed on every palette switch; this hook's subscription re-reads it).
    viz: NODE_KIND_ACCENTS.display,
  };
}

/** The resolved categorical palette (12 hues), re-read when the theme/palette
 *  flips (appThemeStore also bumps on a palette switch). Index with `i % 12`. */
export function useSeriesColors(): string[] {
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  return SERIES_SLOTS.map((slot) => resolveColor(slot));
}

/** Format a numeric axis / category tick compactly, snapping away float and
 *  precision noise: a value that is "really" 3 but arrives as 3.0000000004 (a
 *  pixel→data drag mapping, an accumulated linspace, 0.1+0.2, …) reads as "3",
 *  not its noisy tail. 10 significant figures is far more than any axis tick
 *  needs and reliably clears the noise; the round-trip through Number drops the
 *  trailing zeros toFixed/toPrecision would otherwise leave. */
export function axisTick(n: number): string {
  if (!Number.isFinite(n)) return "";
  return String(Number(n.toPrecision(10)));
}

/** Coerce a pass-through value to a clean numeric series for plotting. Accepts
 *  `unknown` and drops every non-finite cell — a `null` (missing), a `SolError`
 *  object (a #DIV/0! wired in, mirrored onto the node's cachedResult by the error
 *  guard), `NaN`/`Infinity` (dirty-data coercions), text — so recharts only ever
 *  sees real numbers. The `i` is the cell's ORIGINAL index, so x-axis labels
 *  (indexed by row) still line up after gaps are dropped. */
export function toSeries(v: unknown): { i: number; v: number }[] {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : [v];
  const out: { i: number; v: number }[] = [];
  for (let i = 0; i < arr.length; i++) {
    const x = arr[i];
    if (typeof x === "number" && Number.isFinite(x)) out.push({ i, v: x });
  }
  return out;
}
