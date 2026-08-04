// Must stay recharts-FREE: importing a helper here must not drag recharts out of
// its lazily-loaded chunk into the main bundle.
import { useSyncExternalStore } from "react";
import { appThemeStore } from "../appTheme";
import { resolveColor, type PaletteSlot } from "../palette";
import { NODE_KIND_ACCENTS } from "../nodes/shared";

// Every shape reads the same flat `{i,v}[]` series; only the recharts shape differs.
export type ChartShape =
  | "line" | "area" | "bar" | "column"       // cartesian (axes-aware)
  | "pie" | "radar" | "radialbar" | "funnel" // categorical / polar
  | "scatter";                                // index-vs-value dot plot

// The SAME slot order MermaidView uses, so a chart and a diagram beside it color
// their series identically.
const SERIES_SLOTS: PaletteSlot[] = [
  "blue", "gold", "teal", "pink", "green", "purple",
  "sky", "vermilion", "lime", "violet", "amber", "gray",
];

// recharts sets colors as SVG attributes, where CSS var() doesn't resolve — read the
// theme's resolved values instead, and re-read when the theme flips.
export function useChartColors() {
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const cs = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    grid: get("--border-strong", "#3a3a3a"),
    axis: get("--text-dim", "#888"),
    track: get("--gauge-track", "#4d5157"),
    viz: NODE_KIND_ACCENTS.display,
  };
}

/** The resolved categorical palette — index with `i % 12`. */
export function useSeriesColors(): string[] {
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  return SERIES_SLOTS.map((slot) => resolveColor(slot));
}

/** 10 significant figures snaps away float noise (3.0000000004 → "3") while far
 *  exceeding any tick's need; the round-trip through Number drops trailing zeros. */
export function axisTick(n: number): string {
  if (!Number.isFinite(n)) return "";
  return String(Number(n.toPrecision(10)));
}

/** Drops every non-finite cell so recharts only sees real numbers; `i` is the
 *  cell's ORIGINAL index, so x-axis labels still line up after gaps are dropped. */
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
