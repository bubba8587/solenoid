// [[C100]] chartIsAValue, [[D98]] tanstackDrawsCharts
import { type ReactNode, useMemo } from "react";
import { areaX, areaY, barX, barY, defineChart, dot, group, link, lineY, rect, text, type ChartPoint, type ChartTooltipContent } from "@tanstack/charts";
import { Chart } from "@tanstack/charts/react";
import { d3Curve } from "@tanstack/charts/d3/shape";
import { hexbin } from "@tanstack/charts/spatial/hexbin";
import { densityContour } from "@tanstack/charts/spatial/density";
import { scaleSequential } from "d3-scale";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scalePoint } from "@tanstack/charts/scales/point";
import { angleGrid, pie, polar, radialArc, radialArea, radialBarAngle, radialBarRadius, radialDot, radialGrid, radialLine } from "@tanstack/charts/polar";
import { treemap } from "@tanstack/charts/hierarchy/treemap";
import { sankeyDiagram } from "@tanstack/charts/network/sankey";
import { curveLinearClosed, curveStepAfter } from "d3-shape";
import "./chartView.css";
import { LINE_DOT_R, SCATTER_DOT_R, PLOT_TOP, MULTI_LEGEND_H, tipValue, tip, fade, useTheme, valueDomain, axisLabel, indexTicker, indexTicks, SeriesLegend, legendPress, Fig } from "./charts/kit";
import { formatScalar } from "./format";
import { useChartColors, useSeriesColors, axisTick, compactTick, valueTickFormat, niceTicks, partSlices, useSeriesSpotlight, minMaxDecimate, sanitizeChartLabel, type ChartShape } from "./chartCore";
import type { ChartOptions, LineStyle } from "../nodes/chartOptions";
import type { OverlayPayload, XYPayload, XYPoint } from "../chartValue";
import { heightRampColor, resolveColor } from "../palette";
import { colormapRgb } from "../colormaps";
import { ChartTitle, titleHeight } from "./chartTitle";
import { iterMin, iterMax } from "../nodes/mathUtils";

// ─── One series ──────────────────────────────────────────────────────────────

type Row = { i: number; v: number };

export function ChartView({
  op, series: given, width, height, axes, opts, signColors, labels, fontScale,
}: {
  op: ChartShape;
  series: Row[];
  width: number;
  height: number;
  axes: boolean;
  opts?: ChartOptions;
  signColors?: { pos: string; neg: string };
  labels?: (string | number)[];
  fontScale?: number;
}) {
  const { theme, paint, viz, grid } = useTheme();
  const series = op === "line" || op === "area" ? minMaxDecimate(given, width) : given;
  const { dim: sliceDim, pick: pickSlice } = useSeriesSpotlight(series.map((d) => String(d.i)));
  const fs = (fontScale ?? 1) * ((opts?.fontsize ?? 10) / 10);
  const tickFmt = indexTicker(labels);
  const color = opts?.color || viz;
  const lw = opts?.linewidth ?? 1.5;
  const showGrid = axes && (opts?.grid ?? true);
  const showMarkers = opts?.marker ?? axes;
  const dotR = opts?.markersize ?? LINE_DOT_R;
  const fillAlpha = opts?.alpha ?? 0.25;
  const title = opts?.title;
  const chartH = height - (title ? titleHeight(fs) : 0);
  const n = given.length > 0 ? given[given.length - 1].i + 1 : 0;
  const vals = [...series.map((d) => d.v), opts?.ymin, opts?.ymax];
  const yFmt = valueTickFormat(vals);
  const rowTip = (points: readonly ChartPoint[]): ChartTooltipContent => {
    const d = points[0]?.datum as Row | undefined;
    return { title: d ? (labels ? tickFmt(d.i) : `#${d.i + 1}`) : "", rows: [{ label: "", value: tipValue(d?.v) }] };
  };

  const definition = useMemo(() => {
    const isCart = op === "line" || op === "area" || op === "column" || op === "bar" || op === "lollipop";
    const curve = opts?.drawstyle === "steps" ? d3Curve(curveStepAfter) : undefined;
    if (isCart) {
      const horizontal = op === "bar";
      const valuePx = horizontal ? width - 40 : chartH - 30;
      const { domain, ticks } = valueDomain(vals, opts?.ymin, opts?.ymax, valuePx, true);
      const valueAxis = {
        scale: scaleLinear().domain(domain),
        grid: showGrid ? { stroke: grid } : false,
        axis: axes ? { ticks: { values: ticks, format: yFmt, size: 0 }, tickLabels: { fontSize: 9 * fs }, label: axisLabel(horizontal ? opts?.xlabel : opts?.ylabel, fs) } : false as const,
      };
      const idx = series.map((d) => d.i);
      const catTicks = indexTicks(n, horizontal ? chartH : width);
      const catAxis = (band: boolean) => ({
        scale: band ? scaleBand<number>().domain(idx).padding(0.18) : scalePoint<number>().domain(idx).padding(0.02),
        axis: axes ? { ticks: { values: catTicks.filter((t) => idx.includes(t)), format: tickFmt, size: 0 }, tickLabels: { fontSize: 9 * fs }, label: axisLabel(horizontal ? opts?.ylabel : opts?.xlabel, fs) } : false as const,
      });
      const barAlpha = opts?.alpha !== undefined ? fillAlpha : 1;
      if (op === "column") {
        const fill = signColors
          ? (d: Row) => (d.v > 0 ? signColors.pos : d.v < 0 ? signColors.neg : grid)
          : color;
        return defineChart({
          marks: [barY(series, { x: "i", y: "v", fill, fillOpacity: barAlpha })],
          scales: { x: catAxis(true), y: valueAxis },
          guides: axes, margin: axes ? { top: PLOT_TOP } : 2, clip: opts?.ymin !== undefined || opts?.ymax !== undefined, theme, keyboard: false, tooltip: tip(rowTip),
        });
      }
      if (op === "lollipop") {
        return defineChart({
          marks: [
            barY(series, { x: "i", y: "v", fill: color, fillOpacity: barAlpha, maxThickness: lw }),
            dot(series, { x: "i", y: "v", r: opts?.markersize ?? 4, fill: color }),
          ],
          scales: { x: catAxis(true), y: valueAxis },
          guides: axes, margin: axes ? { top: PLOT_TOP } : 2, clip: opts?.ymin !== undefined || opts?.ymax !== undefined, theme, keyboard: false, tooltip: tip(rowTip),
        });
      }
      if (op === "bar") {
        return defineChart({
          marks: [barX(series, { y: "i", x: "v", fill: color, fillOpacity: barAlpha })],
          scales: { y: catAxis(true), x: valueAxis },
          guides: axes, margin: axes ? { top: PLOT_TOP } : 2, clip: opts?.ymin !== undefined || opts?.ymax !== undefined, theme, keyboard: false, tooltip: tip(rowTip),
        });
      }
      const marks = [
        ...(op === "area" ? [areaY(series, { x: "i", y1: 0, y2: "v", fill: color, fillOpacity: fillAlpha, curve })] : []),
        lineY(series, { x: "i", y: "v", stroke: color, strokeOpacity: op === "line" ? opts?.alpha ?? 1 : 1, strokeWidth: lw, curve }),
        ...(showMarkers ? [dot(series, { x: "i", y: "v", r: dotR, fill: color })] : []),
      ];
      return defineChart({
        marks,
        scales: { x: catAxis(false), y: valueAxis },
        guides: axes, margin: axes ? { top: PLOT_TOP } : 2, clip: opts?.ymin !== undefined || opts?.ymax !== undefined, theme, keyboard: false, tooltip: tip(rowTip),
      });
    }
    return null;
  }, [op, series, width, chartH, axes, opts, signColors, labels, theme, color, grid, lw, showGrid, showMarkers, dotR, fillAlpha, fs, n]);

  let chart: ReactNode;
  if (definition) {
    chart = <Chart definition={definition} width={width} height={chartH} ariaLabel={title || `${op} chart`} tabIndex={-1} />;
  } else if (op === "pie") {
    chart = <PieFigure series={series} width={width} height={chartH} opts={opts} labels={labels} fs={fs} tickFmt={tickFmt} dim={sliceDim} pick={pickSlice} />;
  } else if (op === "radar") {
    chart = (
      <RadarFigure
        series={[{ name: "", values: series.map((d) => d.v) }]} labels={labels} indices={series.map((d) => d.i)}
        width={width} height={chartH} opts={opts} fs={fs} paint={paint} dim={() => 1} single
      />
    );
  } else if (op === "rose") {
    chart = <RoseFigure series={series} width={width} height={chartH} opts={opts} labels={labels} fs={fs} tickFmt={tickFmt} dim={sliceDim} pick={pickSlice} />;
  } else if (op === "radialbar") {
    chart = <RadialFigure series={series} width={width} height={chartH} labels={labels} fs={fs} tickFmt={tickFmt} dim={sliceDim} pick={pickSlice} />;
  } else {
    chart = <FunnelFigure series={series} width={width} height={chartH} fs={fs} tickFmt={tickFmt} labels={labels} dim={sliceDim} pick={pickSlice} />;
  }

  return (
    <Fig width={width} height={height}>
      {title && <ChartTitle text={title} fs={fs} />}
      {chart}
    </Fig>
  );
}

// ─── Part-of-whole figures ───────────────────────────────────────────────────

type PieRow = { i: number; v: number; name: string; angle: number; fraction: number };

/** Pie labels in plot pixels (the pie is centred): outside on a leader line, inside on a chip. */
function pieLabelMarks(rows: readonly PieRow[], o: { outside: boolean; inside: boolean; width: number; height: number; pad: number; fs: number; axis: string; grid: string; hole: number }) {
  if (!o.outside && !o.inside) return [];
  const cx = o.width / 2, cy = o.height / 2, R = Math.min(o.width, o.height) / 2 - o.pad;
  const font = 9 * o.fs, stub = 7;
  const at = (d: PieRow, k: number) => ({ x: cx + Math.sin(d.angle) * R * k, y: cy - Math.cos(d.angle) * R * k });
  if (o.inside) {
    const shown = rows.filter((d) => d.fraction >= 0.06 && d.name).map((d) => {
      const p = at(d, o.hole > 0 ? (1 + o.hole) / 2 : 0.62), w = d.name.length * font * 0.6 + 6, h = font + 4;
      return { ...d, ...p, x1: p.x - w / 2, x2: p.x + w / 2, y1: p.y - h / 2, y2: p.y + h / 2 };
    });
    return [
      rect(shown, { x1: "x1", x2: "x2", y1: "y1", y2: "y2", key: "i", fill: "var(--surface)", fillOpacity: 0.72, radius: 3, inset: 0 }),
      text(shown, { x: "x", y: "y", text: "name", key: "i", fontSize: font, fill: o.axis }),
    ];
  }
  const shown = rows.filter((d) => d.fraction >= 0.03 && d.name).map((d) => {
    const edge = at(d, 1), elbow = { x: cx + Math.sin(d.angle) * (R + stub), y: cy - Math.cos(d.angle) * (R + stub) };
    const side = Math.sin(d.angle) >= 0 ? 1 : -1;
    return { ...d, ex: edge.x, ey: edge.y, mx: elbow.x, my: elbow.y, colX: cx + (R + stub) * side, side };
  });
  return [
    link(shown, { x1: "ex", y1: "ey", x2: "mx", y2: "my", key: "i", stroke: o.grid, strokeWidth: 1 }),
    link(shown, { x1: "mx", y1: "my", x2: "colX", y2: "my", key: "i", stroke: o.grid, strokeWidth: 1 }),
    text(shown, { x: "colX", y: "my", dx: (d) => d.side * 3, text: "name", key: "i", fontSize: font, fill: o.axis, anchor: (d) => (d.side > 0 ? "start" : "end") }),
  ];
}

function PieFigure({ series, width, height, opts, labels, fs, tickFmt, dim, pick }: {
  series: Row[]; width: number; height: number; opts?: ChartOptions; labels?: (string | number)[];
  fs: number; tickFmt: (i: number) => string; dim: (j: number) => number; pick: (j: number) => void;
}) {
  const { theme, paint, axis, grid } = useTheme();
  const slices = partSlices("pie", series);
  const mode = opts?.pielabels ?? "outside";
  const labeled = !!labels && mode !== "off";
  const pad = !labeled ? 6 : mode === "inside" ? Math.min(16, width * 0.07) : Math.min(30, width * 0.12);
  const cap = width < 260 ? 10 : 16;
  const hole = opts?.hole ?? 0;
  const definition = useMemo(() => {
    const rows = pie(slices.map((d) => ({ ...d, name: sanitizeChartLabel(tickFmt(d.i), cap) })), { value: "v" });
    const outside = labeled && mode === "outside";
    const inside = labeled && mode === "inside";
    return defineChart({
      marks: [
      polar({
        inset: pad,
        scales: { angle: null, radius: null },
        marks: [
          radialArc(rows, { id: "sol-slice", key: "i", innerRadius: ({ radius }) => radius * hole, fill: (d) => fade(paint(d.i), dim(d.i)), stroke: "var(--surface)", strokeWidth: 1 }),
        ],
      }),
      ...pieLabelMarks(rows, { outside, inside, width, height, pad, fs, axis, grid, hole }),
    ],
      scales: { x: { scale: scaleLinear().domain([0, width]), axis: false }, y: { scale: scaleLinear().domain([height, 0]), axis: false } },
      guides: false, margin: 0, theme,
      focusRing: false, keyboard: false, tooltip: tip((points) => {
        const d = points[0]?.datum as (Row & { name: string }) | undefined;
        return { title: d?.name ?? "", rows: [{ label: "", value: tipValue(d?.v) }] };
      }),
    });
  }, [slices, width, height, pad, labeled, mode, cap, fs, axis, grid, theme, dim, paint, tickFmt, hole]);
  return (
    <Chart definition={definition} width={width} height={height} ariaLabel="pie chart" tabIndex={-1}
      onSelect={(p) => { const d = p?.datum as Row | undefined; if (d && typeof d.i === "number") pick(d.i); }} />
  );
}

/** A rose: one wedge per row, equal angles, the wedge's area (so its radius by square root) carrying the value. */
function RoseFigure({ series, width, height, opts, labels, fs, tickFmt, dim, pick }: {
  series: Row[]; width: number; height: number; opts?: ChartOptions; labels?: (string | number)[];
  fs: number; tickFmt: (i: number) => string; dim: (j: number) => number; pick: (j: number) => void;
}) {
  const { theme, paint, grid } = useTheme();
  const petals = partSlices("rose", series);
  const definition = useMemo(() => {
    const rows = petals.map((d) => ({ ...d, r: Math.sqrt(d.v) }));
    const top = Math.max(1e-9, ...rows.map((d) => d.r));
    return defineChart({
      marks: [polar({
        inset: 4, radiusRatio: labels ? 0.82 : 0.95,
        scales: {
          angle: { scale: () => scaleBand<number>().padding(0.04) },
          radius: { scale: scaleLinear().domain([0, top]) },
        },
        guides: [
          ...((opts?.grid ?? true) ? [radialGrid({ values: [0.25, 0.5, 0.75, 1].map((t) => t * top), stroke: grid })] : []),
          ...(labels ? [angleGrid({ strokeOpacity: 0, format: (v) => sanitizeChartLabel(tickFmt(Number(v)), 10), labelFontSize: 9 * fs })] : []),
        ],
        marks: [radialBarRadius(rows, { id: "sol-slice", angle: "i", radius: "r", key: "i", fill: (d) => fade(paint(d.i), dim(d.i)), stroke: "var(--surface)", strokeWidth: 1 })],
      })],
      scales: { x: null, y: null }, theme, focusRing: false, keyboard: false,
      tooltip: tip((points) => {
        const d = points[0]?.datum as Row | undefined;
        return { title: d ? sanitizeChartLabel(tickFmt(d.i)) : "", rows: [{ label: "", value: tipValue(d?.v) }] };
      }),
    });
  }, [petals, theme, grid, paint, dim, tickFmt, labels, opts, fs]);
  return (
    <Chart definition={definition} width={width} height={height} ariaLabel="rose chart" tabIndex={-1}
      onSelect={(p) => { const d = p?.datum as Row | undefined; if (d && typeof d.i === "number") pick(d.i); }} />
  );
}

function RadialFigure({ series, width, height, labels, fs, tickFmt, dim, pick }: {
  series: Row[]; width: number; height: number; labels?: (string | number)[]; fs: number;
  tickFmt: (i: number) => string; dim: (j: number) => number; pick: (j: number) => void;
}) {
  const { theme, paint, axis, grid } = useTheme();
  const rings = partSlices("radialbar", series);
  const legendH = labels ? MULTI_LEGEND_H : 0;
  const definition = useMemo(() => {
    const max = Math.max(1e-9, ...rings.map((d) => d.v));
    const radius = { scale: () => scaleBand<number>().padding(0.15), range: [({ radius: r }: { radius: number }) => r * 0.18, ({ radius: r }: { radius: number }) => r * 0.92] as const };
    return defineChart({
      marks: [polar({
        inset: 4,
        scales: { angle: { scale: scaleLinear().domain([0, max]) }, radius },
        marks: [
          radialBarAngle(rings, { radius: "i", angle: () => max, fill: grid, cornerRadius: "full", key: (d) => `track${d.i}` }),
          radialBarAngle(rings, { id: "sol-slice", radius: "i", angle: "v", fill: (d) => fade(paint(d.i), dim(d.i)), cornerRadius: "full", key: "i" }),
        ],
      })],
      scales: { x: null, y: null }, theme,
      focusRing: false, keyboard: false, tooltip: tip((points) => {
        const d = points[0]?.datum as Row | undefined;
        return { title: d ? sanitizeChartLabel(tickFmt(d.i)) : "", rows: [{ label: "", value: tipValue(d?.v) }] };
      }),
    });
  }, [rings, theme, grid, paint, dim, tickFmt]);
  return (
    <div onPointerDown={legendPress} onMouseDown={legendPress}>
      <Chart definition={definition} width={width} height={height - legendH} ariaLabel="radial chart" tabIndex={-1}
        onSelect={(p) => { const d = p?.datum as Row | undefined; if (d && typeof d.i === "number") pick(d.i); }} />
      {labels && (
        <SeriesLegend series={rings.map((d) => ({ name: sanitizeChartLabel(tickFmt(d.i)) }))} paint={(k) => paint(rings[k].i)}
          dim={(k) => dim(rings[k].i)} onPick={(k) => pick(rings[k].i)} fs={fs} color={axis} isLine={() => false} />
      )}
    </div>
  );
}

function FunnelFigure({ series, width, height, fs, tickFmt, labels, dim, pick }: {
  series: Row[]; width: number; height: number; fs: number; tickFmt: (i: number) => string;
  labels?: (string | number)[]; dim: (j: number) => number; pick: (j: number) => void;
}) {
  const { theme, paint, axis } = useTheme();
  const stages = partSlices("funnel", series);
  const definition = useMemo(() => {
    const max = Math.max(1e-9, ...stages.map((d) => d.v));
    const n = stages.length;
    // Each stage narrows from its own value to the next stage's; the last narrows to a point.
    const shapes = stages.map((d, k) => {
      const next = stages[k + 1]?.v ?? 0;
      return areaX([{ y: k, x1: -d.v / 2, x2: d.v / 2, i: d.i, v: d.v }, { y: k + 1, x1: -next / 2, x2: next / 2, i: d.i, v: d.v }], {
        id: `sol-slice-${k}`, y: "y", x1: "x1", x2: "x2", fill: fade(paint(d.i), dim(d.i)), fillOpacity: 1, stroke: "var(--surface)", strokeWidth: 1, key: "y",
      });
    });
    return defineChart({
      marks: [
        ...shapes,
        text(stages.map((d, k) => ({ ...d, y: k + 0.5, x: (d.v + (stages[k + 1]?.v ?? 0)) / 4 })), {
          y: "y", x: "x", text: (d) => compactTick(d.v), dx: 6, anchor: "start", fill: axis, fontSize: 10 * fs, key: "i",
        }),
      ],
      scales: {
        x: { scale: scaleLinear().domain([-max / 2, max * 0.62]), axis: false },
        y: { scale: scaleLinear().domain([n, 0]), axis: false },
      },
      guides: false, margin: 4, theme,
      focusRing: false, keyboard: false, tooltip: tip((points) => {
        const d = points[0]?.datum as Row | undefined;
        return { title: d && labels ? tickFmt(d.i) : "", rows: [{ label: "", value: tipValue(d?.v) }] };
      }),
    });
  }, [stages, theme, paint, dim, axis, fs, labels, tickFmt]);
  return (
    <Chart definition={definition} width={width} height={height} ariaLabel="funnel chart" tabIndex={-1}
      onSelect={(p) => { const d = p?.datum as Row | undefined; if (d && typeof d.i === "number") pick(d.i); }} />
  );
}

// ─── Radar ──────────────────────────────────────────────────────────────────

function RadarFigure({ series, labels, indices, width, height, opts, fs, paint, dim, single }: {
  series: { name: string; values: (number | null)[] }[];
  labels?: (string | number)[]; indices?: number[];
  width: number; height: number; opts?: ChartOptions; fs: number;
  paint: (j: number) => string; dim: (j: number) => number; single?: boolean;
}) {
  const { theme, grid } = useTheme();
  const tickFmt = indexTicker(labels);
  const lw = opts?.linewidth ?? 1.5;
  const fillAlpha = opts?.alpha ?? (single ? 0.25 : 0.25);
  const showMarkers = opts?.marker ?? !!single;
  const dotR = opts?.markersize ?? LINE_DOT_R;
  const norm = !single && (opts?.radarscale ?? "axis") === "axis";
  const definition = useMemo(() => {
    const n = series.reduce((m, s) => Math.max(m, s.values.length), 0);
    const spokes = indices ?? Array.from({ length: n }, (_, i) => i);
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const peak = spokes.map((_, k) => series.reduce((m, s) => Math.max(m, num(s.values[k]) ?? 0), 0));
    const rows = series.flatMap((s, j) => spokes.map((spoke, k) => {
      const raw = num(s.values[k]);
      const r = raw == null ? null : norm ? (peak[k] > 0 ? Math.max(0, raw / peak[k]) : 0) : raw;
      return { j, spoke, raw, r };
    }));
    const all = rows.flatMap((d) => (d.r == null ? [] : [d.r]));
    const hi = norm ? 1 : opts?.ymax ?? Math.max(1e-9, ...all);
    const lo = norm ? 0 : opts?.ymin ?? Math.min(0, ...all);
    const marks = series.flatMap((_, j) => {
      const mine = rows.filter((d) => d.j === j && d.r != null);
      const c = paint(j);
      return [
        radialArea(mine, { angle: "spoke", radius: "r", curve: curveLinearClosed, fill: c, fillOpacity: fillAlpha * dim(j), key: "spoke" }),
        radialLine(mine, { angle: "spoke", radius: "r", curve: curveLinearClosed, stroke: c, strokeOpacity: dim(j), strokeWidth: lw, key: "spoke" }),
        ...(showMarkers ? [radialDot(mine, { angle: "spoke", radius: "r", r: dotR, fill: c, key: "spoke" })] : []),
      ];
    });
    return defineChart({
      marks: [polar({
        radiusRatio: single ? 0.72 : 0.68,
        scales: {
          angle: { scale: scalePoint<number>().domain(spokes), wrap: true },
          radius: { scale: scaleLinear().domain([lo, hi]) },
        },
        guides: (opts?.grid ?? true)
          ? [radialGrid({ values: niceTicks(lo, hi, 4).filter((t) => t > lo), shape: "polygon", stroke: grid }), angleGrid({ stroke: grid, format: (v) => tickFmt(Number(v)), labelFontSize: 9 * fs })]
          : [angleGrid({ strokeOpacity: 0, format: (v) => tickFmt(Number(v)), labelFontSize: 9 * fs })],
        marks,
      })],
      scales: { x: null, y: null }, theme,
      keyboard: false, tooltip: tip((points) => {
        const d = points[0]?.datum as { j: number; spoke: number; raw: number | null } | undefined;
        if (!d) return { rows: [] };
        return { title: tickFmt(d.spoke), rows: single ? [{ label: "", value: tipValue(d.raw) }] : [{ label: series[d.j]?.name ?? "", value: tipValue(d.raw), color: paint(d.j) }] };
      }),
    });
  }, [series, indices, norm, opts, paint, dim, lw, fillAlpha, showMarkers, dotR, grid, theme, fs, single, tickFmt]);
  return <Chart definition={definition} width={width} height={height} ariaLabel="radar chart" tabIndex={-1} />;
}

// ─── Several series ──────────────────────────────────────────────────────────

type SeriesRow = { i: number; j: number; v: number | null };

export function MultiSeriesView({
  op, series, labels, width, height, axes, opts, fontScale,
}: {
  op: ChartShape;
  series: { name: string; values: (number | null)[] }[];
  labels?: (string | number)[];
  width: number; height: number; axes: boolean;
  opts?: ChartOptions; fontScale?: number;
}) {
  const { theme, paint, axis, grid } = useTheme();
  const { dim, pick } = useSeriesSpotlight(series.map((s) => s.name));
  const fs = (fontScale ?? 1) * ((opts?.fontsize ?? 10) / 10);
  const tickFmt = indexTicker(labels);
  const title = opts?.title;
  const chartH = height - (title ? titleHeight(fs) : 0) - MULTI_LEGEND_H;
  const lw = opts?.linewidth ?? 1.5;
  const showGrid = axes && (opts?.grid ?? true);
  const showMarkers = opts?.marker ?? false;
  const dotR = opts?.markersize ?? LINE_DOT_R;
  const fillAlpha = opts?.alpha ?? (op === "area" && series.length >= 2 ? 0.18 : 0.25);
  const markAlpha = opts?.alpha ?? 1;

  const definition = useMemo(() => {
    if (op === "radar") return null;
    const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const n = series.reduce((m, s) => Math.max(m, s.values.length), 0);
    const idx = Array.from({ length: n }, (_, i) => i);
    const rows: SeriesRow[] = series.flatMap((s, j) => idx.map((i) => ({ i, j, v: num(s.values[i]) })));
    const vals = [...rows.map((d) => d.v), opts?.ymin, opts?.ymax];
    const horizontal = op === "bar";
    const isBar = op === "bar" || op === "column";
    const { domain, ticks } = valueDomain(vals, opts?.ymin, opts?.ymax, horizontal ? width - 40 : chartH - 30, true);
    const yFmt = valueTickFormat(vals);
    const valueAxis = {
      scale: scaleLinear().domain(domain),
      grid: showGrid ? { stroke: grid } : false,
      axis: axes ? { ticks: { values: ticks, format: yFmt, size: 0 }, tickLabels: { fontSize: 9 * fs }, label: axisLabel(horizontal ? opts?.xlabel : opts?.ylabel, fs) } : false as const,
    };
    const catAxis = {
      scale: isBar ? scaleBand<number>().domain(idx).padding(0.18) : scalePoint<number>().domain(idx).padding(0.02),
      axis: axes ? { ticks: { values: indexTicks(n, horizontal ? chartH : width), format: tickFmt, size: 0 }, tickLabels: { fontSize: 9 * fs }, label: axisLabel(horizontal ? opts?.ylabel : opts?.xlabel, fs) } : false as const,
    };
    const valid = rows.filter((d) => d.v !== null) as (SeriesRow & { v: number })[];
    const fill = (d: SeriesRow) => fade(paint(d.j), markAlpha * dim(d.j));
    const curve = opts?.drawstyle === "steps" ? d3Curve(curveStepAfter) : undefined;
    const stacking = (op === "column" || op === "bar" || op === "area") && series.length >= 2 ? opts?.stacked ?? "off" : "off";
    if (stacking !== "off") return stackedDefinition();
    const groupTip = tip((points) => {
      const first = points[0]?.datum as SeriesRow | undefined;
      return {
        title: first ? tickFmt(first.i) : "",
        rows: points.map((p) => { const d = p.datum as SeriesRow; return { label: series[d.j]?.name ?? "", value: tipValue(d.v), color: paint(d.j) }; }),
      };
    });
    if (op === "column") {
      return defineChart({
        marks: [barY(valid, { x: "i", y: "v", z: "j", fill, layout: group(), key: (d) => `${d.j}:${d.i}` })],
        scales: { x: catAxis, y: valueAxis }, guides: axes, margin: axes ? { top: PLOT_TOP } : 2, theme, focus: "group-x", keyboard: false, tooltip: groupTip,
      });
    }
    if (op === "bar") {
      return defineChart({
        marks: [barX(valid, { y: "i", x: "v", z: "j", fill, layout: group(), key: (d) => `${d.j}:${d.i}` })],
        scales: { y: catAxis, x: valueAxis }, guides: axes, margin: axes ? { top: PLOT_TOP } : 2, theme, focus: "group-y", keyboard: false, tooltip: groupTip,
      });
    }
    // One grouped mark per kind, so a hover finds every series at its x.
    const key = (d: SeriesRow) => `${d.j}:${d.i}`;

    /** Stacked series: each row spans [lo, hi] above the series before it, positives and negatives stacking apart;
     *  in percent each index's spans divide by its total size. */
    function stackedDefinition() {
      const percent = stacking === "percent";
      const spans: (SeriesRow & { v: number; lo: number; hi: number; share: number })[] = [];
      for (const i of idx) {
        const here = valid.filter((d) => d.i === i);
        const total = here.reduce((a, d) => a + Math.abs(d.v), 0) || 1;
        let up = 0, down = 0;
        for (const d of here) {
          const size = percent ? Math.abs(d.v) / total : Math.abs(d.v);
          const share = Math.abs(d.v) / total;
          if (d.v >= 0) { spans.push({ ...d, lo: up, hi: up + size, share }); up += size; }
          else { spans.push({ ...d, lo: down - size, hi: down, share }); down -= size; }
        }
      }
      const ends = spans.flatMap((d) => [d.lo, d.hi]);
      const sd = percent ? { domain: [Math.min(0, ...ends), Math.max(1, ...ends)] as [number, number], ticks: [0, 0.25, 0.5, 0.75, 1] }
        : valueDomain([...ends, opts?.ymin, opts?.ymax], opts?.ymin, opts?.ymax, horizontal ? width - 40 : chartH - 30, true);
      const pct = (t: number) => `${Math.round(t * 100)}%`;
      const vAxis = { ...valueAxis, scale: scaleLinear().domain(sd.domain), axis: axes ? { ...valueAxis.axis, ticks: { values: sd.ticks, format: percent ? pct : valueTickFormat(ends), size: 0 } } : false as const };
      const sKey = (d: SeriesRow) => `${d.j}:${d.i}`;
      const stackTip = tip((points) => {
        const first = points[0]?.datum as SeriesRow | undefined;
        return {
          title: first ? tickFmt(first.i) : "",
          rows: points.map((p) => { const d = p.datum as SeriesRow & { share: number }; return { label: series[d.j]?.name ?? "", value: percent ? `${tipValue(d.v)} (${pct(d.share)})` : tipValue(d.v), color: paint(d.j) }; }),
        };
      });
      const common = { guides: axes, margin: axes ? { top: PLOT_TOP } : 2, theme, keyboard: false, tooltip: stackTip } as const;
      if (op === "column") return defineChart({ marks: [barY(spans, { x: "i", y1: "lo", y2: "hi", z: "j", fill, key: sKey })], scales: { x: catAxis, y: vAxis }, focus: "group-x", ...common });
      if (op === "bar") return defineChart({ marks: [barX(spans, { y: "i", x1: "lo", x2: "hi", z: "j", fill, key: sKey })], scales: { y: catAxis, x: vAxis }, focus: "group-y", ...common });
      return defineChart({
        marks: [
          areaY(spans, { x: "i", y1: "lo", y2: "hi", z: "j", fill: (d) => fade(paint(d.j), Math.max(fillAlpha, 0.55) * dim(d.j)), fillOpacity: 1, key: sKey, curve }),
          lineY(spans, { x: "i", y: "hi", z: "j", stroke: (d) => fade(paint(d.j), dim(d.j)), strokeWidth: lw, key: sKey, curve }),
        ],
        scales: { x: catAxis, y: vAxis }, focus: "group-x", ...common,
      });
    }
    const marks = [
      ...(op === "area" ? [areaY(rows, { x: "i", y1: 0, y2: "v", z: "j", fill: (d) => fade(paint(d.j), fillAlpha * dim(d.j)), fillOpacity: 1, key, curve })] : []),
      lineY(rows, { x: "i", y: "v", z: "j", stroke: (d) => fade(paint(d.j), (op === "line" ? markAlpha : 1) * dim(d.j)), strokeWidth: lw, key, curve }),
      ...(showMarkers ? [dot(valid, { x: "i", y: "v", r: dotR, color: (d) => fade(paint(d.j), dim(d.j)), key })] : []),
    ];
    return defineChart({
      marks, scales: { x: catAxis, y: valueAxis }, guides: axes, margin: axes ? { top: PLOT_TOP } : 2, theme, focus: "group-x", keyboard: false, tooltip: groupTip,
      color: { domain: series.map((_, j) => fade(paint(j), dim(j))), range: series.map((_, j) => fade(paint(j), dim(j))) },
    });
  }, [op, series, width, chartH, axes, opts, theme, grid, paint, dim, lw, showGrid, showMarkers, dotR, fillAlpha, markAlpha, fs, tickFmt]);

  return (
    <div style={{ width, height }} onPointerDown={legendPress} onMouseDown={legendPress}>
      {title && <ChartTitle text={title} fs={fs} />}
      {definition
        ? <Chart definition={definition} width={width} height={chartH} ariaLabel={title || `${op} chart`} tabIndex={-1} />
        : <RadarFigure series={series} labels={labels} width={width} height={chartH} opts={opts} fs={fs} paint={paint} dim={dim} />}
      <SeriesLegend series={series} paint={paint} dim={dim} fs={fs} color={axis} isLine={() => op === "line"} onPick={pick} />
    </div>
  );
}

// ─── Merge Plots ─────────────────────────────────────────────────────────────

export function OverlayView({ payload, width, height, opts, fontScale }: {
  payload: OverlayPayload;
  width: number; height: number; opts?: ChartOptions; fontScale?: number;
}) {
  const { theme, axis, grid } = useTheme();
  const colors = useSeriesColors();
  const series = payload.series;
  const labels = payload.labels;
  const paint = (j: number) => series[j]?.color || colors[j % colors.length];
  const { dim, pick } = useSeriesSpotlight(series.map((s) => s.name));
  const fs = (fontScale ?? 1) * ((opts?.fontsize ?? 10) / 10);
  const tickFmt = indexTicker(labels);
  const title = opts?.title;
  const chartH = height - (title ? titleHeight(fs) : 0) - MULTI_LEGEND_H;

  const definition = useMemo(() => {
    const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const n = series.reduce((m, s) => Math.max(m, s.values.length), 0);
    const idx = Array.from({ length: n }, (_, i) => i);
    const rows: SeriesRow[] = series.flatMap((s, j) => idx.map((i) => ({ i, j, v: num(s.values[i]) })));
    const vals = [...rows.map((d) => d.v), opts?.ymin, opts?.ymax];
    const { domain, ticks } = valueDomain(vals, opts?.ymin, opts?.ymax, chartH - 30, true);
    const barSeries = series.map((s, j) => ({ s, j })).filter(({ s }) => s.kind !== "line" && s.kind !== "area");
    const marks = [
      ...(barSeries.length ? [barY(rows.filter((d) => d.v !== null && barSeries.some((b) => b.j === d.j)) as (SeriesRow & { v: number })[], {
        x: "i", y: "v", z: "j", layout: group(), key: (d) => `${d.j}:${d.i}`,
        fill: (d) => fade(paint(d.j), (series[d.j].alpha ?? 1) * dim(d.j)),
      })] : []),
      ...series.flatMap((s, j) => {
        if (s.kind !== "line" && s.kind !== "area") return [];
        const mine = rows.filter((d) => d.j === j);
        const c = paint(j), o = dim(j);
        const lw = s.linewidth ?? opts?.linewidth ?? 1.5;
        return [
          ...(s.kind === "area" ? [areaY(mine, { x: "i", y1: 0, y2: "v", fill: c, fillOpacity: (s.alpha ?? 0.25) * o, key: "i" })] : []),
          lineY(mine, { x: "i", y: "v", stroke: c, strokeOpacity: (s.kind === "line" ? s.alpha ?? 1 : 1) * o, strokeWidth: lw, key: "i" }),
          ...(s.marker ? [dot(mine.filter((d) => d.v !== null), { x: "i", y: "v", r: s.markersize ?? LINE_DOT_R, fill: c, key: "i" })] : []),
        ];
      }),
    ];
    return defineChart({
      marks,
      scales: {
        x: {
          scale: scaleBand<number>().domain(idx).padding(0.18),
          axis: { ticks: { values: indexTicks(n, width), format: tickFmt, size: 0 }, tickLabels: { fontSize: 9 * fs }, label: axisLabel(opts?.xlabel, fs) },
        },
        y: {
          scale: scaleLinear().domain(domain),
          grid: (opts?.grid ?? true) ? { stroke: grid } : false,
          axis: { ticks: { values: ticks, format: valueTickFormat(vals), size: 0 }, tickLabels: { fontSize: 9 * fs }, label: axisLabel(opts?.ylabel, fs) },
        },
      },
      margin: { top: PLOT_TOP }, theme, focus: "group-x",
      keyboard: false, tooltip: tip((points) => {
        const first = points[0]?.datum as SeriesRow | undefined;
        return {
          title: first ? tickFmt(first.i) : "",
          rows: points.map((p) => { const d = p.datum as SeriesRow; return { label: series[d.j]?.name ?? "", value: tipValue(d.v), color: paint(d.j) }; }),
        };
      }),
    });
  }, [series, width, chartH, opts, theme, grid, dim, fs, tickFmt, colors]);

  return (
    <div style={{ width, height }} onPointerDown={legendPress} onMouseDown={legendPress}>
      {title && <ChartTitle text={title} fs={fs} />}
      <Chart definition={definition} width={width} height={chartH} ariaLabel={title || "merged plot"} tabIndex={-1} />
      <SeriesLegend series={series} paint={paint} dim={dim} fs={fs} color={axis} isLine={(j) => series[j]?.kind === "line"} onPick={pick} />
    </div>
  );
}

// ─── Treemap and Sankey ──────────────────────────────────────────────────────

export function TreemapView({ names, values, width, height, fscale = 1 }: {
  names: string[]; values: number[]; width: number; height: number; fscale?: number;
}) {
  const { theme, paint } = useTheme();
  const data = names
    .map((n, i) => ({ k: i, name: n || `#${i + 1}`, size: Math.max(0, values[i] ?? 0) }))
    .filter((d) => d.size > 0);
  const definition = useMemo(() => defineChart({
    marks: [treemap(data, {
      path: (d) => `root\u0001n${d.k}`, delimiter: "\u0001", value: "size",
      fill: (node) => (node.data ? paint(node.data.k) : "transparent"),
      label: (node) => (node.data ? node.data.name : null),
      labelFill: "#fff", labelFontSize: 10 * fscale, stroke: "var(--surface)", strokeWidth: 1, inset: 0,
    })],
    scales: { x: null, y: null }, guides: false, margin: 0, theme,
    focusRing: false, keyboard: false, tooltip: tip((points) => {
      const node = points[0]?.datum as { data?: { name: string; size: number } | null } | undefined;
      return { title: node?.data?.name ?? "", rows: [{ label: "", value: tipValue(node?.data?.size) }] };
    }),
  }), [data, paint, fscale, theme]);
  if (data.length === 0) return <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>;
  return <Chart definition={definition} width={width} height={height} ariaLabel="treemap" tabIndex={-1} />;
}

type SankeyLinkRow = { source: string; target: string; value: number };

export function SankeyView({ sources, targets, values, width, height, fscale = 1 }: {
  sources: string[]; targets: string[]; values: number[]; width: number; height: number; fscale?: number;
}) {
  const { theme, paint, grid } = useTheme();
  const nodes: { id: string; k: number }[] = [];
  const seen = new Map<string, number>();
  const links: SankeyLinkRow[] = [];
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i] ?? "", t = targets[i] ?? "", v = values[i] ?? 0;
    if (!s || !t || s === t || !(v > 0)) continue;
    for (const n of [s, t]) if (!seen.has(n)) { seen.set(n, nodes.length); nodes.push({ id: n, k: nodes.length }); }
    links.push({ source: s, target: t, value: v });
  }
  const definition = useMemo(() => defineChart({
    marks: [sankeyDiagram({
      nodes, links, nodeKey: "id", source: "source", target: "target", value: "value",
      nodeWidth: 10, nodePadding: 16, inset: { top: 6, right: 10, bottom: 6, left: 10 },
      marks: ({ nodes: laid, links: flows }) => [
        link(flows, { id: "sol-flow", x1: "x1", y1: "y1", x2: "x2", y2: "y2", key: "key", stroke: grid, strokeOpacity: 0.5, strokeWidth: (f) => Math.max(1, f.width), lineCap: "butt" }),
        rect(laid, { x1: "x0", x2: "x1", y1: "y0", y2: "y1", key: "key", inset: 0, color: (n) => n.data.id }),
        text(laid, {
          x: (n) => (n.x0 > width / 2 ? n.x0 - 6 : n.x1 + 6), y: "y", key: "key",
          text: (n) => n.data.id, anchor: (n) => (n.x0 > width / 2 ? "end" : "start"),
          fontSize: 10 * fscale, fill: "var(--text)",
        }),
      ] as const,
    })],
    scales: { x: null, y: null }, guides: false, margin: 0, theme,
    color: { domain: nodes.map((n) => n.id), range: nodes.map((n) => paint(n.k)) },
    focusRing: false, keyboard: false, tooltip: tip((points) => {
      const d = points[0]?.datum as { data?: SankeyLinkRow | { id: string }; value?: number } | undefined;
      const row = d?.data;
      if (row && "source" in row) return { title: `${row.source} → ${row.target}`, rows: [{ label: "", value: tipValue(row.value) }] };
      return { title: row && "id" in row ? row.id : "", rows: [{ label: "", value: tipValue(d?.value) }] };
    }),
  }), [nodes, links, width, grid, paint, fscale, theme]);
  if (links.length === 0) return <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>;
  return <Chart definition={definition} width={width} height={height} ariaLabel="sankey diagram" tabIndex={-1} />;
}

// ─── XY plane ────────────────────────────────────────────────────────────────

const LINE_DASH: Record<LineStyle, string | undefined> = {
  solid: undefined, dashed: "6 4", dotted: "1.5 3", dashdot: "6 3 1.5 3", none: undefined,
};
const BUBBLE_AREA: [number, number] = [40, 420];

const rampCss = (t: number, cmap?: string) => { const [r, g, b] = (cmap ? colormapRgb(cmap, t) : null) ?? heightRampColor(t); return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`; };

/** Pads [lo, hi] so a unit spans the same pixels on both axes. */
function equalDomains(x: [number, number], y: [number, number], pw: number, ph: number): { x: [number, number]; y: [number, number] } {
  const dx = x[1] - x[0] || 1, dy = y[1] - y[0] || 1;
  const u = Math.max(dx / Math.max(1, pw), dy / Math.max(1, ph));
  const grow = (d: [number, number], span: number): [number, number] => {
    const mid = (d[0] + d[1]) / 2;
    return [mid - span / 2, mid + span / 2];
  };
  return { x: grow(x, u * pw), y: grow(y, u * ph) };
}

// Past this many segments a gradient per segment costs more than it shows; each takes its first point's color.
const GRADIENT_SEGMENTS_MAX = 400;
type RampSeg = { x1: number; y1: number; x2: number; y2: number; fill: string; to: string; k: string };
const rampId = (d: RampSeg) => `ramp-${d.k.replace(/[^\w-]/g, "_")}`;
/** A segment's paint: a gradient from its first point's color to its second's, running along the segment's box.
 *  A level or plumb segment has a flat box that can't hold a gradient, so it takes its first point's color. */
function rampPaint(d: RampSeg, count: number): string {
  if (d.fill === d.to || count > GRADIENT_SEGMENTS_MAX || d.x1 === d.x2 || d.y1 === d.y2) return d.fill;
  return `url(#${rampId(d)})`;
}
function rampGradient(d: RampSeg) {
  return {
    id: rampId(d),
    x1: d.x2 >= d.x1 ? 0 : 1, x2: d.x2 >= d.x1 ? 1 : 0,
    y1: d.y2 >= d.y1 ? 1 : 0, y2: d.y2 >= d.y1 ? 0 : 1,
    stops: [{ offset: 0, color: d.fill }, { offset: 1, color: d.to }],
  };
}

type XYRow = XYPoint & { j: number; run: number; seg: number; label?: string; fill: string; r: number };

/** Scatter, XY Line, Bubble and an XY Merge Plots: every series on one numeric plane, broken at each gap. */
export function XYView({ payload, width, height, opts, fontScale }: {
  payload: XYPayload; width: number; height: number; opts?: ChartOptions; fontScale?: number;
}) {
  const { theme, viz, axis, grid } = useTheme();
  const colors = useSeriesColors();
  const fs = (fontScale ?? 1) * ((opts?.fontsize ?? 10) / 10);
  const { series, xcats, names } = payload;
  const { dim, pick } = useSeriesSpotlight(series.map((s) => s.name));
  const multi = series.length > 1;
  const paint = (j: number) => series[j]?.color || (multi ? colors[j % colors.length] : opts?.color || viz);
  const pts = series.flatMap((s) => s.points.filter((p): p is XYPoint => p !== null));
  const cats = series.find((s) => s.cCats)?.cCats;
  const cRange = series.find((s) => s.cRange)?.cRange;
  const catLegend = !multi && !!cats && cats.length > 0;
  const title = opts?.title;
  const legendRows = ((multi && payload.bin !== "hexbin") || catLegend ? 1 : 0) + (cRange ? 1 : 0);
  const chartH = height - (title ? titleHeight(fs) : 0) - legendRows * MULTI_LEGEND_H;

  const definition = useMemo(() => {
    if (pts.length === 0) return null;
    const pointFill = (p: XYPoint, j: number): string => {
      const s = series[j];
      if (typeof p.c === "number" && s.cRange) {
        const [lo, hi] = s.cRange;
        return rampCss(hi > lo ? (p.c - lo) / (hi - lo) : 0.5, opts?.cmap);
      }
      if (typeof p.c === "string" && s.cCats) return colors[Math.max(0, s.cCats.indexOf(p.c)) % colors.length];
      return paint(j);
    };
    const pointR = (p: XYPoint, j: number): number => {
      const s = series[j];
      if (s.sRange) {
        const [lo, hi] = s.sRange;
        const t = p.s === undefined ? 0 : hi > lo ? (p.s - lo) / (hi - lo) : 0.2;
        return Math.sqrt((BUBBLE_AREA[0] + t * (BUBBLE_AREA[1] - BUBBLE_AREA[0])) / Math.PI);
      }
      return s.markersize ?? opts?.markersize ?? (s.line === "none" ? SCATTER_DOT_R : LINE_DOT_R);
    };
    // Each series splits into runs at its gaps; a run is one line.
    const rows: XYRow[] = [];
    let run = 0;
    series.forEach((s, j) => {
      let seg = 0;
      for (const p of s.points) {
        if (p === null) { if (seg) run++; seg = 0; continue; }
        rows.push({ ...p, j, run, seg: seg++, fill: pointFill(p, j), r: pointR(p, j), ...(p.text ? { label: sanitizeChartLabel(p.text, 12) } : {}) });
      }
      if (seg) run++;
    });
    const pw = width - 50, ph = chartH - 34;
    const ext = (vals: number[], lo?: number, hi?: number): [number, number] => [lo ?? iterMin(vals), hi ?? iterMax(vals)];
    let xd = xcats ? { domain: [-0.5, xcats.length - 0.5] as [number, number], ticks: indexTicks(xcats.length, pw) }
      : valueDomain(pts.map((p) => p.x), opts?.xmin, opts?.xmax, pw, false);
    let yd = valueDomain(pts.map((p) => p.y), opts?.ymin, opts?.ymax, ph, false);
    // Room for the largest marker on an open side, so a big bubble at the edge isn't cut.
    const rMax = Math.max(0, ...rows.map((d) => d.r));
    const grow = (d: { domain: [number, number]; ticks: number[] }, px: number, lo?: number, hi?: number) => {
      const u = ((d.domain[1] - d.domain[0]) / Math.max(1, px)) * rMax;
      return { domain: [lo === undefined ? d.domain[0] - u : d.domain[0], hi === undefined ? d.domain[1] + u : d.domain[1]] as [number, number], ticks: d.ticks };
    };
    if (rMax > 4) { yd = grow(yd, ph, opts?.ymin, opts?.ymax); if (!xcats) xd = grow(xd, pw, opts?.xmin, opts?.xmax); }
    if (opts?.aspect === "equal" && !xcats) {
      const eq = equalDomains(ext(pts.map((p) => p.x), opts?.xmin, opts?.xmax), ext(pts.map((p) => p.y), opts?.ymin, opts?.ymax), pw, ph);
      xd = { domain: eq.x, ticks: niceTicks(eq.x[0], eq.x[1], Math.max(3, Math.round(pw / 60))) };
      yd = { domain: eq.y, ticks: niceTicks(eq.y[0], eq.y[1], Math.max(3, Math.round(ph / 40))) };
    }
    const xFmt = (t: number) => (xcats ? xcats[Math.round(t)] ?? "" : axisTick(t));
    const axesOf = () => ({
      x: {
        scale: scaleLinear().domain(xd.domain),
        grid: (opts?.grid ?? true) ? { stroke: grid } : false,
        axis: { ticks: { values: xd.ticks, format: xFmt, size: 0 }, tickLabels: { fontSize: 9 * fs }, label: axisLabel(opts?.xlabel, fs) },
      },
      y: {
        scale: scaleLinear().domain(yd.domain),
        grid: (opts?.grid ?? true) ? { stroke: grid } : false,
        axis: { ticks: { values: yd.ticks, format: valueTickFormat(pts.map((p) => p.y), yd.ticks), size: 0 }, tickLabels: { fontSize: 9 * fs }, label: axisLabel(opts?.ylabel, fs) },
      },
    });
    if (payload.bin === "hexbin") {
      // matplotlib's gridsize counts hexagons across the plot; TanStack bins by pixel spacing.
      const across = opts?.gridsize ?? 20;
      return defineChart({
        marks: [hexbin(rows, { x: "x", y: "y", binWidth: Math.max(4, pw / across), color: "count", stroke: "var(--surface)", strokeWidth: 0.5 })],
        scales: axesOf(), margin: { top: PLOT_TOP }, clip: true, theme, keyboard: false,
        color: { scale: () => scaleSequential((t: number) => rampCss(t, opts?.cmap)) },
        tooltip: tip((points) => {
          const d = points[0]?.datum as { count?: number } | undefined;
          return { rows: [{ label: "points", value: tipValue(d?.count) }] };
        }),
      });
    }
    if (payload.bin === "density") {
      const lw = opts?.linewidth ?? 1;
      // A density spreads past its outermost points, so an open side gets a quarter of the span more room.
      const pad = (d: { domain: [number, number]; ticks: number[] }, lo?: number, hi?: number, px = 200) => {
        const u = (d.domain[1] - d.domain[0]) * 0.25;
        const dom: [number, number] = [lo === undefined ? d.domain[0] - u : d.domain[0], hi === undefined ? d.domain[1] + u : d.domain[1]];
        return { domain: dom, ticks: niceTicks(dom[0], dom[1], Math.max(3, Math.round(px / 60))) };
      };
      xd = pad(xd, opts?.xmin, opts?.xmax, pw);
      yd = pad(yd, opts?.ymin, opts?.ymax, ph);
      return defineChart({
        marks: [densityContour(rows, {
          x: "x", y: "y", z: "j", thresholds: 5,
          fill: (d) => fade(paint(Number(d.group)), (opts?.alpha ?? 0.12) * dim(Number(d.group))),
          stroke: (d) => fade(paint(Number(d.group)), dim(Number(d.group))), strokeWidth: lw,
        })],
        scales: axesOf(), margin: { top: PLOT_TOP }, clip: true, theme, keyboard: false,
      });
    }
    const rampSegs: { x1: number; y1: number; x2: number; y2: number; fill: string; to: string; k: string; lw: number; o: number; dash?: string }[] = [];
    const lines = series.flatMap((s, j) => {
      if (s.line === "none") return [];
      const mine = rows.filter((d) => d.j === j);
      const lw = s.linewidth ?? opts?.linewidth ?? 1.5;
      const lineAlpha = (s.alpha ?? opts?.alpha ?? 1) * dim(j);
      const ramp = !!s.cRange && mine.some((d) => typeof d.c === "number");
      if (ramp) {
        // A ramp line: one segment per neighbour pair, each in its first point's color.
        mine.forEach((a, k) => {
          const b = mine[k + 1];
          if (b && b.run === a.run) rampSegs.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, fill: fade(a.fill, lineAlpha), to: fade(b.fill, lineAlpha), k: `${j}:${k}`, lw, o: lineAlpha, dash: LINE_DASH[s.line] });
        });
        return [];
      }
      return [lineY(mine, { x: "x", y: "y", z: "run", stroke: paint(j), strokeWidth: lw, strokeOpacity: lineAlpha, strokeDasharray: LINE_DASH[s.line], key: (d) => `${d.run}:${d.seg}` })];
    });
    const dots = series.flatMap((s, j) => {
      if (!s.marker) return [];
      const alpha = (s.alpha ?? opts?.alpha ?? (s.sRange ? 0.55 : 1)) * dim(j);
      return [dot(rows.filter((d) => d.j === j), { x: "x", y: "y", r: (d) => d.r, color: (d) => fade(d.fill, alpha), key: (d) => `${d.run}:${d.seg}` })];
    });
    const textRows = rows.filter((d) => d.label);
    return defineChart({
      marks: [
        ...lines,
        ...(rampSegs.length ? [link(rampSegs, { x1: "x1", y1: "y1", x2: "x2", y2: "y2", key: "k", stroke: (d) => rampPaint(d, rampSegs.length), strokeWidth: (d) => d.lw, strokeDasharray: rampSegs[0].dash })] : []),
        ...dots,
        ...(textRows.length ? [text(textRows, { x: "x", y: "y", text: "label", dx: (d) => d.r + 3, anchor: "start", fill: axis, fontSize: 8.5 * fs, key: (d) => `t${d.run}:${d.seg}` })] : []),
      ],
      scales: {
        x: {
          scale: scaleLinear().domain(xd.domain),
          grid: (opts?.grid ?? true) ? { stroke: grid } : false,
          axis: { ticks: { values: xd.ticks, format: xFmt, size: 0 }, tickLabels: { fontSize: 9 * fs }, label: axisLabel(opts?.xlabel, fs) },
        },
        y: {
          scale: scaleLinear().domain(yd.domain),
          grid: (opts?.grid ?? true) ? { stroke: grid } : false,
          axis: { ticks: { values: yd.ticks, format: valueTickFormat(pts.map((p) => p.y), yd.ticks), size: 0 }, tickLabels: { fontSize: 9 * fs }, label: axisLabel(opts?.ylabel, fs) },
        },
      },
      color: { domain: [...new Set(rows.flatMap((d) => series[d.j].marker ? [fade(d.fill, (series[d.j].alpha ?? opts?.alpha ?? (series[d.j].sRange ? 0.55 : 1)) * dim(d.j))] : []))], range: [...new Set(rows.flatMap((d) => series[d.j].marker ? [fade(d.fill, (series[d.j].alpha ?? opts?.alpha ?? (series[d.j].sRange ? 0.55 : 1)) * dim(d.j))] : []))] },
      margin: { top: PLOT_TOP },
      gradients: rampSegs.length <= GRADIENT_SEGMENTS_MAX ? rampSegs.flatMap((d) => (rampPaint(d, rampSegs.length) === d.fill ? [] : [rampGradient(d)])) : [],
      clip: opts?.xmin !== undefined || opts?.xmax !== undefined || opts?.ymin !== undefined || opts?.ymax !== undefined,
      theme,
      keyboard: false, tooltip: tip((points) => {
        const d = points[0]?.datum as XYRow | undefined;
        if (!d || typeof d.x !== "number") return { rows: [] };
        const row = (label: string, value: string | undefined) => (value === undefined ? [] : [{ label, value }]);
        return {
          title: multi ? series[d.j]?.name ?? "" : undefined,
          rows: [
            ...row(names.x ?? "x", xcats ? xcats[d.x] : axisTick(d.x)),
            ...row(names.y ?? "y", tipValue(d.y)),
            ...row(names.s ?? "size", d.s === undefined ? undefined : tipValue(d.s)),
            ...row(names.c ?? "color", d.c === undefined ? undefined : typeof d.c === "number" ? tipValue(d.c) : d.c),
            ...row(names.text ?? "label", d.text),
          ],
        };
      }),
    });
  }, [payload, width, chartH, opts, theme, grid, axis, dim, fs, colors, viz]);

  if (!definition) return <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>;
  const colorbar = cRange && (
    <div style={{ height: MULTI_LEGEND_H, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, fontSize: 9 * fs, color: axis, whiteSpace: "nowrap", overflow: "hidden" }}>
      {names.c && <span>{names.c}</span>}
      <span>{compactTick(cRange[0])}</span>
      <span aria-hidden="true" style={{ width: 60, height: 7, borderRadius: 2, flex: "none", background: `linear-gradient(to right, ${[0, 0.25, 0.5, 0.75, 1].map((t) => rampCss(t, opts?.cmap)).join(", ")})` }} />
      <span>{compactTick(cRange[1])}</span>
    </div>
  );
  return (
    <div style={{ width, height }} onPointerDown={legendPress} onMouseDown={legendPress}>
      {title && <ChartTitle text={title} fs={fs} />}
      <Chart definition={definition} width={width} height={chartH} ariaLabel={title || "xy plot"} tabIndex={-1} />
      {multi && payload.bin !== "hexbin" && (
        <SeriesLegend series={series} paint={paint} dim={dim} fs={fs} color={axis}
          isLine={() => series.some((s) => s.line !== "none")} onPick={pick} />
      )}
      {catLegend && (
        <SeriesLegend series={cats!.map((name) => ({ name }))} paint={(k) => colors[k % colors.length]} dim={() => 1} fs={fs} color={axis}
          isLine={() => false} onPick={() => {}} />
      )}
      {colorbar}
    </div>
  );
}

// ─── Gauge and Tornado ───────────────────────────────────────────────────────

// `pct` is 0 to 100; the caller crops the `size` square to its top half.
export function GaugeArc({ pct, track, size }: { pct: number; track: string; size: number }) {
  const { viz } = useChartColors();
  const definition = useMemo(() => {
    const p = Math.max(0, Math.min(100, pct));
    const half = Math.PI / 2;
    const arcs = [
      { id: "track", startAngle: -half, endAngle: half, fill: track },
      ...(p > 0 ? [{ id: "value", startAngle: -half, endAngle: -half + (p / 100) * Math.PI, fill: viz }] : []),
    ];
    return defineChart({
      marks: [polar({
        scales: { angle: null, radius: null },
        marks: [radialArc(arcs, { key: "id", innerRadius: ({ radius }) => radius * 0.72, outerRadius: ({ radius }) => radius * 0.94, cornerRadius: 7, fill: (d) => d.fill })],
      })],
      scales: { x: null, y: null }, guides: false, margin: 0,
    });
  }, [pct, track, viz]);
  return (
    <div style={{ position: "absolute", top: 0, left: 0 }}>
      <Chart definition={definition} width={size} height={size} ariaLabel="gauge" tabIndex={-1} />
    </div>
  );
}

const RISING = "var(--sol-error)";
const DIVERGED = "var(--text-dim)";

export type TornadoBar = {
  label: string; offset: number; range: number; rising: boolean;
  diverged?: boolean;
  outLow?: number; outHigh?: number; inLow?: number; inHigh?: number; basis?: "slider" | "number";
};

export const TORNADO_W = 218;

export function TornadoBars({ data, grid, axis }: { data: TornadoBar[]; grid: string; axis: string }) {
  const falling = resolveColor("blue");
  const definition = useMemo(() => {
    const ends = data.flatMap((d) => [d.offset, d.offset + d.range]);
    const { domain, ticks } = valueDomain(ends, undefined, undefined, TORNADO_W - 70, false);
    return defineChart({
      marks: [barX(data, {
        y: "label", x1: "offset", x2: (d) => d.offset + d.range, key: "label",
        fill: (d) => (d.diverged ? fade(DIVERGED, 0.4) : d.rising ? RISING : falling),
      })],
      scales: {
        y: { scale: () => scaleBand<string>().padding(0.2), axis: { ticks: { size: 0 }, tickLabels: { fontSize: 9 } } },
        x: { scale: scaleLinear().domain(domain), grid: { stroke: grid }, axis: { ticks: { values: ticks, format: (n: number) => compactTick(n), size: 0 }, tickLabels: { fontSize: 9 } } },
      },
      theme: { foreground: axis, muted: axis, grid, background: "transparent" },
      keyboard: false, tooltip: tip((points) => {
        const d = points[0]?.datum as TornadoBar | undefined;
        if (!d) return { rows: [] };
        return {
          title: d.label,
          rows: [
            { label: "output", value: d.diverged ? "diverged (non-finite)" : `${formatScalar(d.outLow ?? 0)} → ${formatScalar(d.outHigh ?? 0)}` },
            ...(typeof d.inLow === "number" && typeof d.inHigh === "number"
              ? [{ label: "input", value: `${formatScalar(d.inLow)} → ${formatScalar(d.inHigh)} (${d.basis === "slider" ? "slider range" : "±10%"})` }]
              : []),
          ],
        };
      }),
    });
  }, [data, grid, axis, falling]);
  return <Chart definition={definition} width={TORNADO_W} height={Math.max(70, data.length * 22 + 16)} ariaLabel="tornado chart" tabIndex={-1} />;
}
