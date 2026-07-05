// recharts-free chart helpers. Kept OUT of chartView/chartRender so importing a
// colour resolver or a series coercion doesn't drag recharts (~heavy) into the main
// bundle — recharts lives only in the lazily-loaded chartRender.tsx chunk.
import { useSyncExternalStore } from "react";
import { appThemeStore } from "../appTheme";

export const VIZ = "#e9b63a"; // the "display" kind accent

export type ChartShape = "line" | "area" | "bar" | "column";

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

/** Coerce a pass-through value to a clean numeric series for plotting. */
export function toSeries(v: number | number[] | null): { i: number; v: number }[] {
  if (v === null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr
    .map((x, i) => ({ i, v: x }))
    .filter((d) => typeof d.v === "number" && Number.isFinite(d.v));
}
