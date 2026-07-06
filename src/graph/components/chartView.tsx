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

export { VIZ, useChartColors, toSeries } from "./chartCore";
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
  /** Colour bars/columns by value sign (win/loss). */
  signColors?: { pos: string; neg: string };
};

export function ChartView(props: ChartViewProps) {
  return (
    <Suspense fallback={box(props.width, props.height)}>
      <ChartViewInner {...props} />
    </Suspense>
  );
}

export function TreemapView(props: { names: string[]; values: number[]; width: number; height: number }) {
  return (
    <Suspense fallback={box(props.width, props.height)}>
      <TreemapViewInner {...props} />
    </Suspense>
  );
}

export function SankeyView(props: { sources: string[]; targets: string[]; values: number[]; width: number; height: number }) {
  return (
    <Suspense fallback={box(props.width, props.height)}>
      <SankeyViewInner {...props} />
    </Suspense>
  );
}

export function ComposedView(props: { matrix: (number | null)[][]; width: number; height: number }) {
  return (
    <Suspense fallback={box(props.width, props.height)}>
      <ComposedViewInner {...props} />
    </Suspense>
  );
}

export function BubbleView(props: { matrix: (number | null)[][]; width: number; height: number }) {
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
export function ChartFigure({ value, width, height, axes = true }: {
  value: ChartValue; width: number; height: number; axes?: boolean;
}) {
  if (value.op === "kpi" && value.payload?.kind === "kpi") return <KpiCard payload={value.payload} />;
  if (value.op === "bullet" && value.payload?.kind === "bullet") return <BulletBar payload={value.payload} width={width} />;
  if (value.op === "treemap" && value.payload?.kind === "treemap")
    return <TreemapView names={value.payload.names} values={value.payload.values} width={width} height={height} />;
  if (value.op === "sankey" && value.payload?.kind === "sankey")
    return <SankeyView sources={value.payload.sources} targets={value.payload.targets} values={value.payload.values} width={width} height={height} />;
  // The 2-D ops read the matrix; with no matrix wired they fall back to the
  // single `values` series (composed → columns, bubble → a scatter).
  const hasMatrix = Array.isArray(value.matrix) && value.matrix.length > 0;
  if (value.op === "composed") {
    if (hasMatrix) return <ComposedView matrix={value.matrix!} width={width} height={height} />;
    return renderSeries(value, "column", width, height, axes);
  }
  if (value.op === "bubble") {
    if (hasMatrix) return <BubbleView matrix={value.matrix!} width={width} height={height} />;
    return renderSeries(value, "scatter", width, height, axes);
  }
  return renderSeries(value, value.op as ChartShape, width, height, axes);
}

/** The single-series ChartView path with the em-dash empty state — shared by the
 *  series ops and the matrix ops' no-matrix fallback. */
function renderSeries(value: ChartValue, op: ChartShape, width: number, height: number, axes: boolean) {
  const series = toSeries(value.values);
  if (series.length === 0) return <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>;
  return <ChartView op={op} series={series} width={width} height={height} axes={axes} opts={value.options} />;
}

export function GaugeArc(props: { pct: number; track: string; size: number }) {
  return (
    <Suspense fallback={box(props.size, props.size)}>
      <GaugeArcInner {...props} />
    </Suspense>
  );
}

export function TornadoBars(props: { data: TornadoBar[]; grid: string; axis: string }) {
  return (
    <Suspense fallback={box(260, Math.max(70, props.data.length * 22 + 16))}>
      <TornadoBarsInner {...props} />
    </Suspense>
  );
}
