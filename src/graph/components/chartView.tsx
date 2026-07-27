// Lazy indirection layer for the recharts renderers. recharts is heavy, so it's
// isolated in chartRender.tsx and pulled in only when a chart first renders (one
// shared chunk for Chart/Sparkline/Gauge/Tornado). This module stays recharts-free
// so the many `import { ChartView, toSeries } from "./chartView"` sites don't drag
// recharts into the main bundle. recharts-free helpers re-exported from chartCore.
import { lazy, Suspense, type ReactNode } from "react";
import type { ChartShape } from "./chartCore";
import { toSeries } from "./chartCore";
import type { ChartOptions } from "../nodes/chartOptions";
import type { TornadoBar } from "./chartRender";
import type { ChartValue } from "../chartValue";
import { KpiCard, BulletBar } from "./chartCards";
import { SurfaceView } from "./SurfaceView";
import { useSeriesColors } from "./chartCore";
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

// A blank box the size of the chart so the card doesn't reflow (and sockets don't
// re-measure) in the instant before recharts arrives. No text/spinner — it flashes
// too fast to read as anything but a blip; the value box around it is the affordance.
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

export function ComposedView(props: { matrix: (number | null)[][]; width: number; height: number; fscale?: number }) {
  return (
    <Suspense fallback={box(props.width, props.height)}>
      <ComposedViewInner {...props} />
    </Suspense>
  );
}

export function BubbleView(props: { matrix: (number | null)[][]; width: number; height: number; fscale?: number }) {
  return (
    <Suspense fallback={box(props.width, props.height)}>
      <BubbleViewInner {...props} />
    </Suspense>
  );
}

/** Render ANY ChartValue by its op: series ops → the recharts ChartView, the
 *  eager payload cards (kpi/bullet), or the structured recharts figures
 *  (treemap/sankey). The ONE place that maps a chart value to a figure — shared by
 *  the Display and Composite-boundary node surfaces (a report embed keeps its own
 *  width-measured wrapper). Empty → the muted em-dash box. */
export function ChartFigure({ value, width, height, axes = true, fontScale }: {
  value: ChartValue; width: number; height: number; axes?: boolean;
  /** Display-layer text multiplier (an FC on the chart socket); composes with
   *  the value's own options.fontsize (matplotlib points, 10 = built-in). */
  fontScale?: number;
}) {
  // The payload/matrix figures don't read options, so fold both factors here;
  // ChartView folds options.fontsize itself (it takes `opts` directly).
  const fscale = (fontScale ?? 1) * ((value.options?.fontsize ?? 10) / 10);
  // Hook BEFORE any early return (a conditional hook here black-screens the app —
  // the TablePopup lesson). Waffle is the only consumer; the others theme inside.
  const seriesColors = useSeriesColors();
  if (value.op === "kpi" && value.payload?.kind === "kpi") return <KpiCard payload={value.payload} fscale={fscale} />;
  if (value.op === "bullet" && value.payload?.kind === "bullet") return <BulletBar payload={value.payload} width={width} fscale={fscale} />;
  if (value.op === "treemap" && value.payload?.kind === "treemap")
    return <TreemapView names={value.payload.names} values={value.payload.values} width={width} height={height} fscale={fscale} />;
  if (value.op === "sankey" && value.payload?.kind === "sankey")
    return <SankeyView sources={value.payload.sources} targets={value.payload.targets} values={value.payload.values} width={width} height={height} fscale={fscale} />;
  if (value.op === "surface" && value.payload?.kind === "surface")
    return <SurfaceView payload={value.payload} width={width} height={height} />;
  // The canvas-figure wave (2026-07-16): each draws itself into one <canvas>.
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
  if (value.op === "waffle" && value.payload?.kind === "waffle")
    return <WaffleView payload={value.payload} width={width} height={height} colors={seriesColors} />;
  if (value.op === "quiver" && value.payload?.kind === "quiver")
    return <QuiverView payload={value.payload} width={width} height={height} />;
  if (value.op === "sevenseg" && value.payload?.kind === "sevenseg")
    return <SevenSegView text={value.payload.text} width={width} height={height} />;
  // The 2-D ops read the matrix; with no matrix wired they fall back to the
  // single `values` series (composed → columns, bubble → a scatter).
  const hasMatrix = Array.isArray(value.matrix) && value.matrix.length > 0;
  if (value.op === "composed") {
    if (hasMatrix) return <ComposedView matrix={value.matrix!} width={width} height={height} fscale={fscale} />;
    return renderSeries(value, "column", width, height, axes, fontScale);
  }
  if (value.op === "bubble") {
    if (hasMatrix) return <BubbleView matrix={value.matrix!} width={width} height={height} fscale={fscale} />;
    return renderSeries(value, "scatter", width, height, axes, fontScale);
  }
  return renderSeries(value, value.op as ChartShape, width, height, axes, fontScale);
}

/** The single-series ChartView path with the em-dash empty state — shared by the
 *  series ops and the matrix ops' no-matrix fallback. */
function renderSeries(value: ChartValue, op: ChartShape, width: number, height: number, axes: boolean, fontScale?: number) {
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

export function TornadoBars(props: { data: TornadoBar[]; grid: string; axis: string }) {
  // 218 = TORNADO_W (kept a literal so the lazy chartRender chunk isn't pulled
  // eagerly just to read the constant).
  return (
    <Suspense fallback={box(218, Math.max(70, props.data.length * 22 + 16))}>
      <TornadoBarsInner {...props} />
    </Suspense>
  );
}
