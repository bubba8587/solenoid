// Lazy indirection layer for the recharts renderers. recharts is heavy, so it's
// isolated in chartRender.tsx and pulled in only when a chart first renders (one
// shared chunk for Chart/Sparkline/Gauge/Tornado). This module stays recharts-free
// so the many `import { ChartView, toSeries } from "./chartView"` sites don't drag
// recharts into the main bundle. recharts-free helpers re-exported from chartCore.
import { lazy, Suspense, type ReactNode } from "react";
import type { ChartShape } from "./chartCore";
import type { ChartOptions } from "../nodes/chartOptions";
import type { TornadoBar } from "./chartRender";

export { VIZ, useChartColors, toSeries } from "./chartCore";
export type { ChartShape } from "./chartCore";
export type { TornadoBar } from "./chartRender";

const ChartViewInner = lazy(() => import("./chartRender").then((m) => ({ default: m.ChartView })));
const GaugeArcInner = lazy(() => import("./chartRender").then((m) => ({ default: m.GaugeArc })));
const TornadoBarsInner = lazy(() => import("./chartRender").then((m) => ({ default: m.TornadoBars })));

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
};

export function ChartView(props: ChartViewProps) {
  return (
    <Suspense fallback={box(props.width, props.height)}>
      <ChartViewInner {...props} />
    </Suspense>
  );
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
