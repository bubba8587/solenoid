// Spike: TanStack Charts versions of a few chartRender.tsx figures, same props, same palette.
import { useMemo } from "react";
import { areaY, barX, barY, defineChart, dot, lineY } from "@tanstack/charts";
import { Chart } from "@tanstack/charts/react";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { pie, polar, radialArc } from "@tanstack/charts/polar";
import { tooltip } from "@tanstack/charts/tooltip";
import { minMaxDecimate } from "../../src/graph/components/chartCore";

export type Shape = "line" | "area" | "column" | "bar" | "pie";
export type Pt = { i: number; v: number };

// The theme reads CSS custom properties directly, so no getComputedStyle round-trip per theme change.
export const THEME = {
  foreground: "var(--text-dim, #888)",
  muted: "var(--text-dim, #888)",
  grid: "var(--border-strong, #3a3a3a)",
  background: "transparent",
};

export function defineFigure(op: Shape, series: Pt[], axes: boolean, color: string, palette: string[]) {
  const rows = series.map((d) => ({ ...d, label: String(d.i + 1) }));
  const guides = axes;
  const yAxis = { scale: scaleLinear, nice: true, grid: axes ? { opacity: 1 } : false, axis: axes ? { tickSize: 0 } : false } as const;
  const theme = { ...THEME, palette };
  if (op === "pie") {
    const slices = pie(rows, { value: "v" });
    return defineChart({
      marks: [polar({ inset: 4, radiusRatio: 0.9, marks: [radialArc(slices, { color: "label", key: "label" })], scales: { angle: null, radius: null } })],
      scales: { x: null, y: null },
      color: { domain: rows.map((r) => r.label), range: palette },
      theme, tooltip,
    });
  }
  if (op === "column") {
    return defineChart({
      marks: [barY(rows, { x: "label", y: "v", fill: color })],
      scales: { x: { scale: () => scaleBand().padding(0.18), axis: axes }, y: yAxis },
      guides, theme, tooltip,
    });
  }
  if (op === "bar") {
    return defineChart({
      marks: [barX(rows, { y: "label", x: "v", fill: color })],
      scales: { y: { scale: () => scaleBand().padding(0.18), axis: axes }, x: { ...yAxis } },
      guides, theme, tooltip,
    });
  }
  const line = lineY(rows, { x: "i", y: "v", stroke: color, strokeWidth: 1.5, points: axes });
  return defineChart({
    marks: op === "area" ? [areaY(rows, { x: "i", y: "v", fill: color, fillOpacity: 0.25 }), line] : [line],
    scales: { x: { scale: scaleLinear, axis: axes }, y: yAxis },
    guides, theme, tooltip,
  });
}

export function TsChartView({ op, series, width, height, axes, color, palette }: {
  op: Shape; series: Pt[]; width: number; height: number; axes: boolean; color: string; palette: string[];
}) {
  const definition = useMemo(() => defineFigure(op, op === "line" || op === "area" ? minMaxDecimate(series, width) : series, axes, color, palette), [op, series, axes, color, palette, width]);
  return <Chart definition={definition} width={width} height={height} ariaLabel={`${op} chart`} style={{ fontSize: 9 }} />;
}

export type XY = { x: number; y: number; s: string };
export function TsScatter({ points, width, height, palette }: { points: XY[]; width: number; height: number; palette: string[] }) {
  const definition = useMemo(() => defineChart({
    marks: [dot(points, { x: "x", y: "y", color: "s", r: 2.5 })],
    scales: { x: { scale: scaleLinear, grid: { opacity: 1 } }, y: { scale: scaleLinear, grid: { opacity: 1 } } },
    theme: { ...THEME, palette }, tooltip,
  }), [points, palette]);
  return <Chart definition={definition} width={width} height={height} ariaLabel="scatter" style={{ fontSize: 9 }} />;
}

export type TBar = { label: string; offset: number; range: number; rising: boolean };
export function TsTornado({ data, rising, falling }: { data: TBar[]; rising: string; falling: string }) {
  // An explicit interval (x1..x2) replaces recharts' transparent-offset-bar stacking trick.
  const definition = useMemo(() => defineChart({
    marks: [barX(data, { y: "label", x1: "offset", x2: (d) => d.offset + d.range, fill: (d) => (d.rising ? rising : falling) })],
    scales: { y: { scale: () => scaleBand().padding(0.2) }, x: { scale: scaleLinear, grid: { opacity: 1 } } },
    theme: THEME, tooltip,
  }), [data, rising, falling]);
  return <Chart definition={definition} width={218} height={Math.max(70, data.length * 22 + 16)} ariaLabel="tornado" style={{ fontSize: 9 }} />;
}
