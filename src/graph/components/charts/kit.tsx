// [[C100]] chartIsAValue, [[D98]] tanstackDrawsCharts
// The pieces every TanStack figure shares: theme, tooltips, value axes, index ticks and the DOM legend.
import { createContext, useContext, type SyntheticEvent, type ReactNode } from "react";
import { type ChartPoint, type ChartTooltipContent } from "@tanstack/charts";
import { tooltip } from "@tanstack/charts/tooltip";
import { colord } from "colord";
import { formatScalar } from "../format";
import { useChartColors, useSeriesColors, axisTick, niceTicks } from "../chartCore";
import { colormapRgb } from "../../colormaps";
import { heightRampColor, divergingRampColor, resolveColor } from "../../palette";
import type { ChartOptions } from "../../nodes/chartOptions";

export const LINE_DOT_R = 2;
export const SCATTER_DOT_R = 3;
export const ALL_TICKS_UPTO = 12;
// Headroom over an axed plot for the card's expand button.
export const PLOT_TOP = 14;
export const MULTI_LEGEND_H = 18;

/** A tooltip value: an object becomes its error code, so a row never prints "[object Object]". */
export function tipValue(v: unknown): string {
  if (typeof v === "number") return formatScalar(v);
  if (v == null) return "";
  if (typeof v === "object") return String((v as { code?: string }).code ?? "—");
  return String(v);
}

/** A tooltip that never pins: a click on a card's figure belongs to the canvas and the spotlight. */
export function tip(content: (points: readonly ChartPoint[]) => ChartTooltipContent) {
  return { use: tooltip, sticky: false, content: (points: readonly ChartPoint[]) => content(points) };
}

/** A paint at an opacity, so one mark can spotlight a single slice. */
export function fade(color: string, a: number): string {
  if (a >= 1) return color;
  const c = colord(color);
  return c.isValid() ? c.alpha(c.alpha() * a).toRgbString() : color;
}

export type Theme = { foreground: string; muted: string; grid: string; background: string; palette: readonly string[] };
export function useTheme(): { theme: Theme; paint: (j: number) => string; viz: string; grid: string; axis: string } {
  const { grid, axis, viz } = useChartColors();
  const palette = useSeriesColors();
  return {
    theme: { foreground: axis, muted: axis, grid, background: "transparent", palette },
    paint: (j: number) => palette[j % palette.length],
    viz, grid, axis,
  };
}

/** One TanStack chart at a fixed size; the card owns focus, so the figure takes no tab stop. */
export function Fig({ children, width, height }: { children: ReactNode; width: number; height: number }) {
  return <div className="sol-chart" style={{ width, height }}>{children}</div>;
}

/** Round ends and ticks for a value axis: the given bounds stand, an open side rounds out from the data. */
export function valueDomain(values: Iterable<unknown>, lo: number | undefined, hi: number | undefined, px: number, zero: boolean): { domain: [number, number]; ticks: number[] } {
  let min = Infinity, max = -Infinity;
  for (const v of values) if (typeof v === "number" && Number.isFinite(v)) { min = Math.min(min, v); max = Math.max(max, v); }
  if (!Number.isFinite(min)) { min = 0; max = 1; }
  if (zero) { min = Math.min(min, 0); max = Math.max(max, 0); }
  let a = lo ?? min, b = hi ?? max;
  if (a === b) { a -= a === 0 ? 1 : Math.abs(a) * 0.1; b += b === 0 ? 1 : Math.abs(b) * 0.1; }
  if (a > b) [a, b] = [b, a];
  const count = Math.max(4, Math.round(px / 32));
  const raw = niceTicks(a, b, count);
  const step = raw.length > 1 ? raw[1] - raw[0] : (b - a);
  if (lo === undefined) a = Math.floor(a / step + 1e-9) * step;
  if (hi === undefined) b = Math.ceil(b / step - 1e-9) * step;
  // The ticks keep the step the ends were rounded to, so a rounded end always carries a tick.
  const ticks: number[] = [];
  for (let v = Math.ceil(a / step - 1e-9) * step; v <= b + step * 1e-9; v += step) ticks.push(Number(v.toPrecision(12)));
  return { domain: [a, b], ticks };
}

export function axisLabel(textValue: string | undefined, fs: number) {
  return textValue ? { text: textValue, fontSize: 10 * fs } : undefined;
}

/** The x tick text of an index axis: the row's label, or its 1-based position. */
export function indexTicker(labels: (string | number)[] | undefined) {
  return (i: number | string) => {
    const idx = Math.round(Number(i));
    if (!Number.isFinite(idx)) return "";
    if (labels) {
      const lab = labels[idx];
      if (lab == null || typeof lab === "object") return "";
      return typeof lab === "number" ? axisTick(lab) : String(lab);
    }
    return idx >= 0 ? String(idx + 1) : "";
  };
}

/** Index ticks: every row up to a dozen, else about one per 48 px. */
export function indexTicks(n: number, px: number): number[] {
  if (n <= ALL_TICKS_UPTO) return Array.from({ length: n }, (_, i) => i);
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(px / 48))));
  const out: number[] = [];
  for (let i = 0; i < n; i += every) out.push(i);
  return out;
}

export function SeriesLegend({ series, paint, dim, onPick, fs, color, isLine }: {
  series: { name: string }[];
  paint: (j: number) => string;
  dim: (j: number) => number;
  onPick: (j: number) => void;
  fs: number; color: string; isLine: (j: number) => boolean;
}) {
  return (
    <div
      className="sol-chart-legend"
      style={{ height: MULTI_LEGEND_H, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, fontSize: 9 * fs, color, lineHeight: 1, overflow: "hidden", whiteSpace: "nowrap", cursor: "pointer", userSelect: "none" }}
    >
      {series.map((s, j) => (
        <span key={j} onClick={() => onPick(j)} style={{ display: "inline-flex", alignItems: "center", gap: 4, opacity: dim(j) }}>
          <span aria-hidden="true" style={{ width: 8, height: isLine(j) ? 2 : 8, borderRadius: isLine(j) ? 1 : 2, background: paint(j), flex: "none" }} />
          {s.name}
        </span>
      ))}
    </div>
  );
}

// rete's drag takes pointer capture on mousedown and would steal the legend's click.
export const legendPress = (e: SyntheticEvent) => {
  if ((e.target as Element | null)?.closest?.(".sol-chart-legend")) e.stopPropagation();
};



/** True while a figure draws for export: a figure that paints marks on a canvas for speed draws them as SVG instead. */
export const ChartExportContext = createContext(false);
export const useForExport = () => useContext(ChartExportContext);

export const EmptyFigure = () => <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>;

export type Rgb = [number, number, number];
export const rgbCss = ([r, g, b]: Rgb) => `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;

/** The color of `t` under the options: the named cmap, else the palette's diverging ramp with a center, else its height ramp. */
export function heatColorFn(o: Pick<ChartOptions, "cmap" | "center">): (t: number) => Rgb {
  if (o.cmap) return (t) => colormapRgb(o.cmap!, t) ?? heightRampColor(t);
  return o.center !== undefined ? divergingRampColor : heightRampColor;
}

/** A font for measuring, in the same family stack the SVG text falls back through, so an unloaded face can't skew it. */
export function measureFont(weight: number, px: number, face: "sans" | "mono" = "sans"): string {
  const stack = getComputedStyle(document.documentElement).getPropertyValue(face === "mono" ? "--font-mono" : "--font-sans").trim();
  return `${weight} ${px}px ${stack || "sans-serif"}`;
}

let measureCtx: CanvasRenderingContext2D | null = null;
export function measureText(s: string, font: string): number {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  if (!measureCtx) return s.length * 6;
  measureCtx.font = font;
  return measureCtx.measureText(s).width;
}

/** `s`, cut with an ellipsis to fit `max` pixels in `font`. */
export function fitLabel(s: string, max: number, font: string): string {
  if (measureText(s, font) <= max) return s;
  let t = s;
  while (t.length > 1 && measureText(`${t}…`, font) > max) t = t.slice(0, -1);
  return `${t}…`;
}

/** The theme's paints as resolved values, so a canvas-painted mark and an export get real colors. */
export function useInk() {
  const t = useTheme();
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
  return {
    ...t, dim: t.axis,
    up: resolveColor("green"), down: resolveColor("vermilion"), neutral: resolveColor("blue"),
    accent: v("--accent", resolveColor("sky")),
    text: v("--text", "#ccc"), border: v("--border-strong", "#555"), sunken: v("--surface-sunken", "#2a2a2a"),
  };
}
