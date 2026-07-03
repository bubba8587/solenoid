import { BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { useSyncExternalStore } from "react";
import "./chartView.css";
import { formatScalar } from "./format";
import { appThemeStore } from "../appTheme";
import type { ChartOptions } from "../nodes/chartOptions";

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

// A hover readout that shows the value at a sensible precision (formatScalar),
// not recharts' raw full-float. Point index is 1-based.
function ChartTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { value?: number }[];
  label?: number | string;
}) {
  if (!active || !payload || !payload.length) return null;
  const v = payload[0]?.value;
  return (
    <div style={{ fontSize: 11, padding: "2px 6px", background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)" }}>
      <span style={{ color: "var(--text-dim)" }}>#{Number(label) + 1}</span>
      {"  "}
      {typeof v === "number" ? formatScalar(v) : v}
    </div>
  );
}

const TIP = <Tooltip isAnimationActive={false} cursor={{ stroke: "rgba(128,128,128,0.5)", fill: "rgba(128,128,128,0.12)" }} content={<ChartTooltip />} />;

/** Coerce a pass-through value to a clean numeric series for plotting. */
export function toSeries(v: number | number[] | null): { i: number; v: number }[] {
  if (v === null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr
    .map((x, i) => ({ i, v: x }))
    .filter((d) => typeof d.v === "number" && Number.isFinite(d.v));
}

/**
 * One recharts renderer for both the inline node charts and the expand popup.
 * `axes` adds gridlines + numbered axes (the big "Chart" look); without it you
 * get a clean Sparkline. `opts` carries the matplotlib-style overrides from a
 * Chart's Options socket (Sparkline passes none). Hover shows a small readout
 * formatted via formatScalar (not recharts' raw full-float).
 */
export function ChartView({
  op, series, width, height, axes, opts,
}: {
  op: ChartShape;
  series: { i: number; v: number }[];
  width: number;
  height: number;
  axes: boolean;
  opts?: ChartOptions;
}) {
  const { grid, axis } = useChartColors();
  const AXIS = { fontSize: 9, fill: axis } as const;
  const tickFmt = (i: number | string) => String(Number(i) + 1);

  // Resolved style from the options (fall back to the defaults that shipped).
  const color = opts?.color || VIZ;
  const lw = opts?.linewidth ?? 1.5;
  const showGrid = axes && (opts?.grid ?? true);
  const showMarkers = opts?.marker ?? axes; // lines dot by default when axed
  const fillAlpha = opts?.alpha ?? 0.25;
  // YAxis domain when ylim is given; recharts uses "auto" for an open bound.
  const yDomain = opts?.ymin !== undefined || opts?.ymax !== undefined
    ? [opts?.ymin ?? "auto", opts?.ymax ?? "auto"] as [number | string, number | string]
    : undefined;
  const xLabel = axes && opts?.xlabel
    ? { value: opts.xlabel, position: "insideBottom" as const, offset: -3, fontSize: 10, fill: axis }
    : undefined;
  const yLabel = axes && opts?.ylabel
    ? { value: opts.ylabel, angle: -90, position: "insideLeft" as const, fontSize: 10, fill: axis }
    : undefined;
  // Make room for axis labels / a title when present.
  const title = opts?.title;
  const titleH = title ? 16 : 0;
  const chartH = height - titleH;
  const yAxisW = axes ? (yLabel ? 40 : 26) : 0;
  const bottomM = axes ? (xLabel ? 18 : 4) : 2;
  const margin = axes ? { top: 6, right: 8, bottom: bottomM, left: 0 } : { top: 2, right: 2, bottom: 2, left: 2 };

  let chart;
  if (op === "line") {
    chart = (
      <LineChart width={width} height={chartH} data={series} margin={margin}>
        {showGrid && <CartesianGrid stroke={grid} />}
        {axes && <XAxis dataKey="i" tick={AXIS} tickLine={false} tickFormatter={tickFmt} label={xLabel} height={xLabel ? 28 : undefined} />}
        {axes && <YAxis tick={AXIS} tickLine={false} width={yAxisW} domain={yDomain} label={yLabel} />}
        {TIP}
        <Line dataKey="v" stroke={color} strokeWidth={lw} isAnimationActive={false} dot={showMarkers ? { r: 2 } : false} />
      </LineChart>
    );
  } else if (op === "area") {
    chart = (
      <AreaChart width={width} height={chartH} data={series} margin={margin}>
        {showGrid && <CartesianGrid stroke={grid} />}
        {axes && <XAxis dataKey="i" tick={AXIS} tickLine={false} tickFormatter={tickFmt} label={xLabel} height={xLabel ? 28 : undefined} />}
        {axes && <YAxis tick={AXIS} tickLine={false} width={yAxisW} domain={yDomain} label={yLabel} />}
        {TIP}
        <Area dataKey="v" stroke={color} fill={color} fillOpacity={fillAlpha} strokeWidth={lw} isAnimationActive={false} dot={showMarkers ? { r: 2 } : false} />
      </AreaChart>
    );
  } else if (op === "bar") {
    // Horizontal bars (category down the Y axis).
    chart = (
      <BarChart width={width} height={chartH} data={series} layout="vertical" margin={margin}>
        {showGrid && <CartesianGrid stroke={grid} horizontal={false} />}
        {axes && <XAxis type="number" tick={AXIS} tickLine={false} domain={yDomain} label={xLabel} height={xLabel ? 28 : undefined} />}
        {axes && <YAxis type="category" dataKey="i" tick={AXIS} tickLine={false} width={yLabel ? 32 : 18} tickFormatter={tickFmt} label={yLabel} />}
        {TIP}
        <Bar dataKey="v" fill={color} fillOpacity={fillAlpha < 1 && opts?.alpha !== undefined ? fillAlpha : 1} isAnimationActive={false} />
      </BarChart>
    );
  } else {
    // "column" — vertical bars.
    chart = (
      <BarChart width={width} height={chartH} data={series} margin={margin}>
        {showGrid && <CartesianGrid stroke={grid} vertical={false} />}
        {axes && <XAxis dataKey="i" tick={AXIS} tickLine={false} tickFormatter={tickFmt} label={xLabel} height={xLabel ? 28 : undefined} />}
        {axes && <YAxis tick={AXIS} tickLine={false} width={yAxisW} domain={yDomain} label={yLabel} />}
        {TIP}
        <Bar dataKey="v" fill={color} fillOpacity={opts?.alpha !== undefined ? fillAlpha : 1} isAnimationActive={false} />
      </BarChart>
    );
  }

  if (!title) return chart;
  return (
    <div style={{ width }}>
      <div style={{ height: titleH, lineHeight: `${titleH}px`, textAlign: "center", fontSize: 11, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {title}
      </div>
      {chart}
    </div>
  );
}
