// This module must stay recharts-FREE, or its many import sites drag recharts into
// the main bundle.
import { lazy, Suspense, type ReactNode } from "react";
import type { ChartShape } from "./chartCore";
import { toSeries } from "./chartCore";
import type { ChartOptions } from "../nodes/chartOptions";
import type { TornadoBar } from "./chartRender";
import type { ChartValue, ScalePayload, OverlayPayload } from "../chartValue";
import { KpiCard, BulletBar, RecordCardView } from "./chartCards";
import { SurfaceView } from "./SurfaceView";
import { useSeriesColors, useChartColors } from "./chartCore";
import {
  WaterfallView, CandleView, BoxplotView, CalHeatView, WaffleView, QuiverView, ContourView, SevenSegView,
} from "./chartCanvasViews";

export { useChartColors, toSeries } from "./chartCore";
export type { ChartShape } from "./chartCore";
export type { TornadoBar } from "./chartRender";

const ChartViewInner = lazy(() => import("./chartRender").then((m) => ({ default: m.ChartView })));
const GaugeArcInner = lazy(() => import("./chartRender").then((m) => ({ default: m.GaugeArc })));
const TornadoBarsInner = lazy(() => import("./chartRender").then((m) => ({ default: m.TornadoBars })));
const TreemapViewInner = lazy(() => import("./chartRender").then((m) => ({ default: m.TreemapView })));
const SankeyViewInner = lazy(() => import("./chartRender").then((m) => ({ default: m.SankeyView })));
const ComposedViewInner = lazy(() => import("./chartRender").then((m) => ({ default: m.ComposedView })));
const BubbleViewInner = lazy(() => import("./chartRender").then((m) => ({ default: m.BubbleView })));
const MultiSeriesViewInner = lazy(() => import("./chartRender").then((m) => ({ default: m.MultiSeriesView })));
const OverlayViewInner = lazy(() => import("./chartRender").then((m) => ({ default: m.OverlayView })));

// The cartesian ops that draw one child per named series; the rest stay single-series
// (pie/radialbar/funnel plot the first series, the payload figures ignore `series`).
const MULTI_SERIES_OPS = new Set<ChartShape>(["column", "bar", "line", "area", "scatter", "radar"]);

// A blank box the chart's size so the card doesn't reflow (and sockets don't
// re-measure) before recharts arrives; no spinner — it flashes too fast to read.
function box(width: number | string, height: number): ReactNode {
  return <div style={{ width, height }} />;
}

type ChartViewProps = {
  op: ChartShape;
  series: { i: number; v: number }[];
  width: number;
  height: number;
  axes: boolean;
  opts?: ChartOptions;
  /** Color bars/columns by value sign (win/loss). */
  signColors?: { pos: string; neg: string };
  /** X-axis category labels (Frame col 0) — shown instead of the 1,2,3… index. */
  labels?: (string | number)[];
  /** Display-layer text multiplier (an FC on the chart socket). */
  fontScale?: number;
};

export function ChartView(props: ChartViewProps) {
  return (
    <Suspense fallback={box(props.width, props.height)}>
      <ChartViewInner {...props} />
    </Suspense>
  );
}

export function TreemapView(props: { names: string[]; values: number[]; width: number; height: number; fscale?: number }) {
  return (
    <Suspense fallback={box(props.width, props.height)}>
      <TreemapViewInner {...props} />
    </Suspense>
  );
}

export function SankeyView(props: { sources: string[]; targets: string[]; values: number[]; width: number; height: number; fscale?: number }) {
  return (
    <Suspense fallback={box(props.width, props.height)}>
      <SankeyViewInner {...props} />
    </Suspense>
  );
}

type SeriesArg = { name: string; values: (number | null)[] }[];

export function ComposedView(props: { series: SeriesArg; labels?: (string | number)[]; width: number; height: number; opts?: ChartOptions; fscale?: number }) {
  return (
    <Suspense fallback={box(props.width, props.height)}>
      <ComposedViewInner {...props} />
    </Suspense>
  );
}

export function BubbleView(props: { series: SeriesArg; width: number; height: number; opts?: ChartOptions; fscale?: number }) {
  return (
    <Suspense fallback={box(props.width, props.height)}>
      <BubbleViewInner {...props} />
    </Suspense>
  );
}

export function MultiSeriesView(props: {
  op: ChartShape; series: { name: string; values: (number | null)[] }[];
  labels?: (string | number)[]; width: number; height: number; axes: boolean;
  opts?: ChartOptions; fontScale?: number;
}) {
  return (
    <Suspense fallback={box(props.width, props.height)}>
      <MultiSeriesViewInner {...props} />
    </Suspense>
  );
}

export function OverlayView(props: { payload: OverlayPayload; width: number; height: number; opts?: ChartOptions; fontScale?: number }) {
  return (
    <Suspense fallback={box(props.width, props.height)}>
      <OverlayViewInner {...props} />
    </Suspense>
  );
}

/** The ONE place that maps a chart value to a figure (a report embed keeps its own
 *  width-measured wrapper); empty → the muted em-dash box. */
export function ChartFigure({ value, width, height, axes = true, fontScale, recordNav }: {
  value: ChartValue; width: number; height: number; axes?: boolean;
  /** Composes with the value's own options.fontsize (10 = the built-in sizes). */
  fontScale?: number;
  /** Row stepper for a drawn record card; surfaces that can reach the Record
   *  node (Display, the chart popup via recordNav.ts) provide it. */
  recordNav?: (delta: number) => void;
}) {
  // The payload/matrix figures don't read options, so fold both factors here.
  const fscale = (fontScale ?? 1) * ((value.options?.fontsize ?? 10) / 10);
  // Hook BEFORE any early return — a conditional hook here black-screens the app.
  const seriesColors = useSeriesColors();
  if (value.op === "kpi" && value.payload?.kind === "kpi") return <KpiCard payload={value.payload} fscale={fscale} />;
  if (value.op === "scale" && value.payload?.kind === "scale")
    return value.payload.style === "dial"
      ? <ScaleDial payload={value.payload} width={width} />
      : <BulletBar payload={value.payload} width={width} fscale={fscale} />;
  if (value.op === "proportion" && value.payload?.kind === "proportion")
    return value.payload.layout === "treemap"
      ? <TreemapView names={value.payload.names} values={value.payload.values} width={width} height={height} fscale={fscale} />
      : <WaffleView payload={value.payload} width={width} height={height} colors={seriesColors} />;
  if (value.op === "sankey" && value.payload?.kind === "sankey")
    return <SankeyView sources={value.payload.sources} targets={value.payload.targets} values={value.payload.values} width={width} height={height} fscale={fscale} />;
  if (value.op === "surface" && value.payload?.kind === "surface")
    return <SurfaceView payload={value.payload} width={width} height={height} />;
  if (value.op === "contour" && value.payload?.kind === "contour")
    return <ContourView payload={value.payload} width={width} height={height} />;
  if (value.op === "waterfall" && value.payload?.kind === "waterfall")
    return <WaterfallView payload={value.payload} width={width} height={height} />;
  if (value.op === "candle" && value.payload?.kind === "candle")
    return <CandleView payload={value.payload} width={width} height={height} />;
  if (value.op === "boxplot" && value.payload?.kind === "boxplot")
    return <BoxplotView payload={value.payload} width={width} height={height} />;
  if (value.op === "calheat" && value.payload?.kind === "calheat")
    return <CalHeatView payload={value.payload} width={width} height={height} />;
  if (value.op === "quiver" && value.payload?.kind === "quiver")
    return <QuiverView payload={value.payload} width={width} height={height} />;
  if (value.op === "sevenseg" && value.payload?.kind === "sevenseg")
    return <SevenSegView text={value.payload.text} width={width} height={height} />;
  if (value.op === "record" && value.payload?.kind === "record")
    return <RecordCardView payload={value.payload} width={width} fscale={fscale} title={value.options?.title} onStep={recordNav} />;
  if (value.op === "overlay" && value.payload?.kind === "overlay")
    return <OverlayView payload={value.payload} width={width} height={height} opts={value.options} fontScale={fontScale} />;
  // Composed/Bubble read the frame's numeric columns as series; a plain list (no series)
  // falls back to the single-series column/scatter render.
  const hasSeries = !!value.series && value.series.length > 0;
  if (value.op === "composed") {
    if (hasSeries) return <ComposedView series={value.series!} labels={value.labels} width={width} height={height} opts={value.options} fscale={fscale} />;
    return renderSeries(value, "column", width, height, axes, fontScale);
  }
  if (value.op === "bubble") {
    if (hasSeries) return <BubbleView series={value.series!} width={width} height={height} opts={value.options} fscale={fscale} />;
    return renderSeries(value, "scatter", width, height, axes, fontScale);
  }
  return renderSeries(value, value.op as ChartShape, width, height, axes, fontScale);
}

/** The single-series path, shared with the matrix ops' no-matrix fallback. */
function renderSeries(value: ChartValue, op: ChartShape, width: number, height: number, axes: boolean, fontScale?: number) {
  // A frame with ≥ 2 numeric columns draws one series per column (with a legend).
  if (value.series && value.series.length >= 2 && MULTI_SERIES_OPS.has(op)) {
    return <MultiSeriesView op={op} series={value.series} labels={value.labels} width={width} height={height} axes={axes} opts={value.options} fontScale={fontScale} />;
  }
  const series = toSeries(value.values);
  if (series.length === 0) return <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>;
  return <ChartView op={op} series={series} width={width} height={height} axes={axes} opts={value.options} labels={value.labels} fontScale={fontScale} />;
}

export function GaugeArc(props: { pct: number; track: string; size: number }) {
  return (
    <Suspense fallback={box(props.size, props.size)}>
      <GaugeArcInner {...props} />
    </Suspense>
  );
}

/** The DIAL figure — a radial arc (Value read as a fraction of 1, clamped onto the fixed
 *  0→100% arc) with the true percent below. Shared by the Gauge node's card and the chart
 *  popup / Report embed, so both draw the same dial. */
export function ScaleDial({ payload, width, size }: { payload: ScalePayload; width?: number; size?: number }) {
  const { track } = useChartColors();
  const v = typeof payload.value === "number" && Number.isFinite(payload.value) ? payload.value : null;
  const frac = v === null ? 0 : Math.min(1, Math.max(0, v));
  const dim = size ?? Math.max(120, Math.min(width ?? 160, 200));
  return (
    <div style={{ position: "relative", width: dim, height: Math.round(dim * 0.55), margin: "2px auto 0", overflow: "hidden" }}>
      <GaugeArc pct={frac * 100} track={track} size={dim} />
      <div style={{ position: "absolute", left: 0, right: 0, top: Math.round(dim * 0.31), textAlign: "center", fontSize: 16, fontWeight: 600, color: "var(--text)" }}>
        {v === null ? "—" : `${Math.round(v * 1000) / 10}%`}
      </div>
      <div style={{ position: "absolute", left: 4, bottom: 0, fontSize: 9, color: "var(--text-dim)" }}>0%</div>
      <div style={{ position: "absolute", right: 4, bottom: 0, fontSize: 9, color: "var(--text-dim)" }}>100%</div>
    </div>
  );
}

export function TornadoBars(props: { data: TornadoBar[]; grid: string; axis: string }) {
  // 218 = TORNADO_W, a literal so reading it doesn't pull the lazy chunk eagerly.
  return (
    <Suspense fallback={box(218, Math.max(70, props.data.length * 22 + 16))}>
      <TornadoBarsInner {...props} />
    </Suspense>
  );
}
