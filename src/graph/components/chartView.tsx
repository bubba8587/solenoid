// [[B3]] sameNodeEverywhere, [[C100]] chartIsAValue
import { lazy, memo, Suspense, useEffect, useState, type ReactNode } from "react";
import type { ChartShape } from "./chartCore";
import { toSeries, partSlices, figurePoints, HEAVY_FIGURE_POINTS } from "./chartCore";
import type { ChartOptions } from "../nodes/chartOptions";
import type { TornadoBar } from "./chartRender";
import type { ChartRef, ChartValue, ScalePayload, OverlayPayload, XYPayload } from "../chartValue";
import { KpiCard, BulletBar, RecordCardView } from "./chartCards";
import type { FormatAnnotation } from "../formatAnnotationStore";
import { SurfaceView } from "./SurfaceView";
import { useSeriesColors, useChartColors } from "./chartCore";
// `ganttSvg` is imported eagerly: the export provider must return a string synchronously.
import { ganttSvg, type GanttPayload } from "@solenoid/gantt-layout";
import { LadderView } from "./ladderView";
import type { LadderAction } from "../nodes/ladderOps";
import { registerChartSvgProvider } from "../canvasCapture";
import { useHostNodeId } from "./nodeContext";
import { ChartTitle, titleHeight, UNTITLED_FIGURES } from "./chartTitle";
import {
  WaterfallView, CandleView, BoxplotView, CalHeatView, HeatmapView, WaffleView, QuiverView, ContourView,
} from "./chartCanvasViews";

export { useChartColors, toSeries } from "./chartCore";
export type { ChartShape } from "./chartCore";
export type { TornadoBar } from "./chartRender";

const ChartViewInner = lazy(() => import("./chartRender").then((m) => ({ default: m.ChartView })));
const GaugeArcInner = lazy(() => import("./chartRender").then((m) => ({ default: m.GaugeArc })));
const TornadoBarsInner = lazy(() => import("./chartRender").then((m) => ({ default: m.TornadoBars })));
const TreemapViewInner = lazy(() => import("./chartRender").then((m) => ({ default: m.TreemapView })));
const SankeyViewInner = lazy(() => import("./chartRender").then((m) => ({ default: m.SankeyView })));
const XYViewInner = lazy(() => import("./chartRender").then((m) => ({ default: m.XYView })));
const MultiSeriesViewInner = lazy(() => import("./chartRender").then((m) => ({ default: m.MultiSeriesView })));
const OverlayViewInner = lazy(() => import("./chartRender").then((m) => ({ default: m.OverlayView })));
const GanttFigureInner = lazy(() => import("@solenoid/gantt-react").then((m) => ({ default: m.GanttFigure })));

const GANTT_EXPORT_W = 1000;

const MULTI_SERIES_OPS = new Set<ChartShape>(["column", "bar", "line", "area", "radar"]);

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
  signColors?: { pos: string; neg: string };
  labels?: (string | number)[];
  fontScale?: number;
  refs?: readonly ChartRef[];
};

export function ChartView(props: ChartViewProps) {
  return (
    <Suspense fallback={box(props.width, props.height)}>
      <ChartViewInner {...props} />
    </Suspense>
  );
}

function TreemapView(props: { names: string[]; values: number[]; width: number; height: number; fscale?: number }) {
  return (
    <Suspense fallback={box(props.width, props.height)}>
      <TreemapViewInner {...props} />
    </Suspense>
  );
}

function SankeyView(props: { sources: string[]; targets: string[]; values: number[]; width: number; height: number; fscale?: number }) {
  return (
    <Suspense fallback={box(props.width, props.height)}>
      <SankeyViewInner {...props} />
    </Suspense>
  );
}

function XYView(props: { payload: XYPayload; width: number; height: number; opts?: ChartOptions; fontScale?: number; refs?: readonly ChartRef[] }) {
  return (
    <Suspense fallback={box(props.width, props.height)}>
      <XYViewInner {...props} />
    </Suspense>
  );
}

function MultiSeriesView(props: {
  op: ChartShape; series: { name: string; values: (number | null)[] }[];
  labels?: (string | number)[]; width: number; height: number; axes: boolean;
  opts?: ChartOptions; fontScale?: number; refs?: readonly ChartRef[];
}) {
  return (
    <Suspense fallback={box(props.width, props.height)}>
      <MultiSeriesViewInner {...props} />
    </Suspense>
  );
}

function OverlayView(props: { payload: OverlayPayload; width: number; height: number; opts?: ChartOptions; fontScale?: number; refs?: readonly ChartRef[] }) {
  return (
    <Suspense fallback={box(props.width, props.height)}>
      <OverlayViewInner {...props} />
    </Suspense>
  );
}

function GanttView({ payload, width, height, virtualize, fontScale }: {
  payload: GanttPayload; width: number; height: number; virtualize?: boolean; fontScale?: number;
}) {
  const hostId = useHostNodeId();
  useEffect(() => {
    if (!hostId || virtualize) return;
    return registerChartSvgProvider(hostId, () => ganttSvg(payload, { width: GANTT_EXPORT_W }));
  }, [hostId, virtualize, payload]);
  return (
    <Suspense fallback={box(width, height)}>
      <GanttFigureInner payload={payload} width={width} height={height} virtualize={virtualize} fontScale={fontScale} />
    </Suspense>
  );
}

type FigureProps = {
  value: ChartValue; width: number; height: number; axes?: boolean;
  fontScale?: number;
  recordNav?: (delta: number) => void;
  /** A Choice Ladder's figure can change its node's choices when the surface knows the node. */
  ladderAction?: (a: LadderAction) => void;
  virtualize?: boolean;
  /** A KPI card's number format, from its Value input. */
  valueFormat?: FormatAnnotation;
};

const RESIZE_SETTLE_MS = 160;

/** The size a heavy figure draws at: the live size once it has held still for a moment, else the last such size. */
function useSettledSize(width: number, height: number, heavy: boolean): { w: number; h: number } {
  const [settled, setSettled] = useState({ w: width, h: height });
  useEffect(() => {
    if (settled.w === width && settled.h === height) return;
    if (!heavy) { setSettled({ w: width, h: height }); return; }
    const t = setTimeout(() => setSettled({ w: width, h: height }), RESIZE_SETTLE_MS);
    return () => clearTimeout(t);
  }, [width, height, heavy, settled]);
  return heavy ? settled : { w: width, h: height };
}

// [[C120]] linearWork: a resize of a heavy figure costs a transform per frame, and one redraw when it stops.
export const ChartFigure = memo(function ChartFigure(props: FigureProps) {
  const { value, width, height } = props;
  const heavy = value.op !== "gantt" && figurePoints(value) > HEAVY_FIGURE_POINTS;
  const { w, h } = useSettledSize(width, height, heavy);
  if (!heavy) return <FigureBody {...props} />;
  return (
    <div style={{ width, height, overflow: "hidden" }}>
      <div style={{ width: w, height: h, transform: `scale(${width / w}, ${height / h})`, transformOrigin: "0 0", willChange: "transform" }}>
        <FigureBody {...props} width={w} height={h} />
      </div>
    </div>
  );
});

const FigureBody = memo(function FigureBody({ value, width, height, axes = true, fontScale, recordNav, ladderAction, virtualize, valueFormat }: FigureProps) {
  const fscale = (fontScale ?? 1) * ((value.options?.fontsize ?? 10) / 10);
  // Before any early return: a conditional hook here black-screens the app.
  const seriesColors = useSeriesColors();
  const title = value.options?.title?.trim();
  if (title && UNTITLED_FIGURES.has(value.op)) {
    const th = titleHeight(fscale);
    return (
      <div style={{ width, margin: "0 auto" }}>
        <ChartTitle text={title} fs={fscale} />
        <FigureBody
          value={{ ...value, options: { ...value.options, title: undefined } }}
          width={width} height={Math.max(0, height - th)} axes={axes} fontScale={fontScale} recordNav={recordNav} ladderAction={ladderAction} virtualize={virtualize} valueFormat={valueFormat}
        />
      </div>
    );
  }
  if (value.op === "kpi" && value.payload?.kind === "kpi") return <KpiCard payload={value.payload} fscale={fscale} format={valueFormat} />;
  if (value.op === "scale" && value.payload?.kind === "scale")
    return value.payload.style === "dial"
      ? <ScaleDial payload={value.payload} width={width} height={height} fscale={fscale} />
      : <BulletBar payload={value.payload} width={width} fscale={fscale} />;
  if (value.op === "proportion" && value.payload?.kind === "proportion")
    return value.payload.layout === "treemap"
      ? <TreemapView names={value.payload.names} values={value.payload.values} width={width} height={height} fscale={fscale} />
      : <WaffleView payload={value.payload} width={width} height={height} colors={seriesColors} fscale={fscale} />;
  if (value.op === "sankey" && value.payload?.kind === "sankey")
    return <SankeyView sources={value.payload.sources} targets={value.payload.targets} values={value.payload.values} width={width} height={height} fscale={fscale} />;
  if (value.op === "surface" && value.payload?.kind === "surface")
    return <SurfaceView payload={value.payload} options={value.options} width={width} height={height} />;
  if (value.op === "contour" && value.payload?.kind === "contour")
    return <ContourView payload={value.payload} options={value.options} width={width} height={height} fscale={fscale} />;
  if (value.op === "waterfall" && value.payload?.kind === "waterfall")
    return <WaterfallView payload={value.payload} width={width} height={height} fscale={fscale} />;
  if (value.op === "candle" && value.payload?.kind === "candle")
    return <CandleView payload={value.payload} width={width} height={height} fscale={fscale} />;
  if (value.op === "boxplot" && value.payload?.kind === "boxplot")
    return <BoxplotView payload={value.payload} width={width} height={height} fscale={fscale} />;
  if (value.op === "calheat" && value.payload?.kind === "calheat")
    return <CalHeatView payload={value.payload} options={value.options} width={width} height={height} fscale={fscale} />;
  if (value.op === "heatmap" && value.payload?.kind === "heatmap")
    return <HeatmapView payload={value.payload} options={value.options} width={width} height={height} fscale={fscale} />;
  if (value.op === "quiver" && value.payload?.kind === "quiver")
    return <QuiverView payload={value.payload} options={value.options} width={width} height={height} />;
  if (value.op === "record" && value.payload?.kind === "record")
    return <RecordCardView payload={value.payload} width={width} fscale={fscale} title={value.options?.title} onStep={recordNav} />;
  if (value.payload?.kind === "xy")
    return <XYView payload={value.payload} width={width} height={height} opts={value.options} fontScale={fontScale} refs={value.refs} />;
  if (value.op === "overlay" && value.payload?.kind === "overlay")
    return <OverlayView payload={value.payload} width={width} height={height} opts={value.options} fontScale={fontScale} refs={value.refs} />;
  if (value.op === "gantt" && value.payload?.kind === "gantt")
    return <GanttView payload={value.payload} width={width} height={height} virtualize={virtualize} fontScale={fscale} />;
  if (value.op === "ladder" && value.payload?.kind === "ladder")
    return <LadderView payload={value.payload} width={width} height={height} fscale={fscale} onAction={ladderAction} />;
  if (value.op === "scatter" || value.op === "xyline" || value.op === "bubble") return EMPTY_FIGURE;
  return renderSeries(value, value.op as ChartShape, width, height, axes, fontScale);
});

const EMPTY_FIGURE = <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>;

function renderSeries(value: ChartValue, op: ChartShape, width: number, height: number, axes: boolean, fontScale?: number) {
  if (value.series && value.series.length >= 2 && MULTI_SERIES_OPS.has(op)) {
    if (!value.series.some((s) => toSeries(s.values).length > 0)) return EMPTY_FIGURE;
    return <MultiSeriesView op={op} series={value.series} labels={value.labels} width={width} height={height} axes={axes} opts={value.options} fontScale={fontScale} refs={value.refs} />;
  }
  const series = partSlices(op, toSeries(value.values));
  if (series.length === 0) return EMPTY_FIGURE;
  return <ChartView op={op} series={series} width={width} height={height} axes={axes} opts={value.options} labels={value.labels} fontScale={fontScale} refs={value.refs} />;
}

export function GaugeArc(props: { pct: number; track: string; size: number }) {
  return (
    <Suspense fallback={box(props.size, props.size)}>
      <GaugeArcInner {...props} />
    </Suspense>
  );
}

/** Given a height, the dial grows to fill it (a resized Display, a Dashboard box); else it stays card-sized. The scale's
 *  ends sit on a row under the arc, where the arc's own ends would cover them. */
function ScaleDial({ payload, width, height, size, fscale = 1 }: { payload: ScalePayload; width?: number; height?: number; size?: number; fscale?: number }) {
  const { track } = useChartColors();
  const v = typeof payload.value === "number" && Number.isFinite(payload.value) ? payload.value : null;
  const frac = v === null ? 0 : Math.min(1, Math.max(0, v));
  const ends = Math.round(13 * fscale);
  const dim = size ?? Math.max(120, Math.min(width ?? 160, height ? (height - ends) / 0.55 : 200));
  return (
    <div style={{ position: "relative", width: dim, height: Math.round(dim * 0.55) + ends, margin: "2px auto 0", overflow: "hidden" }}>
      <GaugeArc pct={frac * 100} track={track} size={dim} />
      <div style={{ position: "absolute", left: 0, right: 0, top: Math.round(dim * 0.31), textAlign: "center", fontSize: Math.max(16, dim / 10) * fscale, fontWeight: 600, color: "var(--text)" }}>
        {v === null ? "—" : `${Math.round(v * 1000) / 10}%`}
      </div>
      <div style={{ position: "absolute", left: 4, bottom: 0, fontSize: 9 * fscale, color: "var(--text-dim)" }}>0%</div>
      <div style={{ position: "absolute", right: 4, bottom: 0, fontSize: 9 * fscale, color: "var(--text-dim)" }}>100%</div>
    </div>
  );
}

export function TornadoBars(props: { data: TornadoBar[]; grid: string; axis: string }) {
  // 218 is TORNADO_W, as a literal so reading it doesn't pull the lazy chunk.
  return (
    <Suspense fallback={box(218, Math.max(70, props.data.length * 22 + 16))}>
      <TornadoBarsInner {...props} />
    </Suspense>
  );
}
