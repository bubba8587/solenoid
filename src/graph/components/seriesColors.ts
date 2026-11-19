// [[C100]] chartIsAValue
// The series colors and the figure's scope, apart from chartCore's axes and ticks, so a chip that colors its categories
// (CategoryChip, in the Obsidian plugin too) reads them without the chart toolkit.
import { createContext, useContext, useSyncExternalStore } from "react";
import { themeColor } from "./themeColor";
import { appThemeStore } from "../appTheme";
import { resolveColor, type PaletteSlot } from "../palette";

// The same slot order as MermaidView, so a chart and a diagram side by side color their series alike.
export const SERIES_SLOTS: PaletteSlot[] = [
  "blue", "gold", "teal", "pink", "green", "purple",
  "sky", "vermilion", "lime", "violet", "amber", "gray",
];

// recharts writes colors as SVG attributes, where CSS var() doesn't resolve.
/** Where a figure draws, for the styling it reads: an HTML Page's slot, so the page's CSS variables (its colors,
 *  `--chart-1`…, `--chart-font-scale`) reach the charts in it ([[reports-and-notes#HTML pages]]); none reads the app's. */
export const FigureScope = createContext<Element | null>(null);

/** The series colors in order: a scope's `--chart-1`, `--chart-2`… where it sets them, else the palette's. */
export function useSeriesColors(): string[] {
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const scope = useContext(FigureScope);
  return SERIES_SLOTS.map((slot, i) => (scope ? themeColor(`--chart-${i + 1}`, "", scope) : "") || resolveColor(slot));
}
