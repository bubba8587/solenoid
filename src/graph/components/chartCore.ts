// [[C100]] chartIsAValue, [[C97]] rechartsLazyChunk
// Must stay recharts-free: a helper imported from here must not drag recharts into the main bundle.
import { useSyncExternalStore } from "react";
import { appThemeStore } from "../appTheme";
import { resolveColor, type PaletteSlot } from "../palette";
import { NODE_KIND_ACCENTS } from "../nodes/shared";

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
    viz: NODE_KIND_ACCENTS.display,
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
