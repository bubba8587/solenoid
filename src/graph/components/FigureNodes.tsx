import { useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { GraphNode } from "../graphModel";
import type {
  WaterfallNode, CandlestickNode, BoxplotNode,
  CalendarHeatmapNode, HeatmapNode, ProportionNode, ProportionLayout, QuiverNode, UsMapNode, UsMapScope,
} from "../nodeClasses";
import { PROPORTION_LAYOUT_OPTIONS, US_MAP_SCOPE_OPTIONS } from "../nodeClasses";
import type { ChartValue, ChartPayload } from "../chartValue";
import { isSolError, type SolError } from "../errorValue";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { ChartFigure } from "./chartView";
import { calendarHeight, periodHeight } from "./heatmapLayout";
import { legendLines } from "../geo/usMapLegend";
import { ChartChip } from "./ChartChip";
import { OpToggle, SegToggle } from "./SegToggle";
import { collapseStore } from "../collapseStore";
import { processEdited } from "../process";
import { getOwningView } from "../activeGraph";

// One shared card for every figure node; the figure comes from ChartFigure, so a card and a Report embed render identically.

type FigureNode = GraphNode & {
  id: string;
  cachedChart: ChartValue | SolError | null;
  width: number;
  height: number;
};

function makeFigureComponent<N extends FigureNode>(
  figHeight: number | ((cv: ChartValue, width: number) => number),
  hasData: (p: ChartPayload | undefined) => boolean,
  controls?: (data: N) => ReactNode,
) {
  return function FigureComponent({ data, emit }: NodeProps<N>) {
    const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));
    const raw = data.cachedChart;
    const err = raw && isSolError(raw) ? raw : null;
    const cv = raw && !isSolError(raw) ? raw : null;
    const has = !!cv && hasData(cv.payload);
    const figW = (data.width ?? 240) - 22; // card width minus body padding
    return (
      <NodeShell node={data} emit={emit}>
        {controls?.(data)}
        <InlineInputs node={data} emit={emit} />
        <div className="solenoid-node__section-divider" />
        {!collapsed && has && cv
          ? <ChartFigure value={cv} width={figW} height={typeof figHeight === "number" ? figHeight : figHeight(cv, figW)} />
          : !(collapsed && cv) && <div className="solenoid-node__display-value solenoid-node__display-value--empty" title={err?.message}>{err ? err.code : "—"}</div>}
        {cv && (
          <div className="solenoid-node__collapsed-only solenoid-node__display-value solenoid-node__display-value--chip">
            <ChartChip value={cv} />
          </div>
        )}
      </NodeShell>
    );
  };
}

export const WaterfallComponent = makeFigureComponent<WaterfallNode>(
  170,
  (p) => p?.kind === "waterfall" && p.values.length > 0,
);

export const CandlestickComponent = makeFigureComponent<CandlestickNode>(
  170,
  (p) => p?.kind === "candle" && p.close.length > 0,
);

export const BoxplotComponent = makeFigureComponent<BoxplotNode>(
  170,
  (p) => p?.kind === "boxplot" && p.boxes.length > 0,
);

// The height the wrapped weeks (or the grouped grid) need at the card's width, plus the title strip; the tick width
// is a typical label's.
export const CalendarHeatmapComponent = makeFigureComponent<CalendarHeatmapNode>(
  (cv, w) => {
    const p = cv.payload?.kind === "calheat" ? cv.payload : null;
    if (!p) return 110;
    const tick = cv.options.cbar === false ? null : 22;
    const fig = p.period && p.period !== "day" ? periodHeight(p.days, p.period, w, 1, tick) : calendarHeight(p.days, w, 1, tick);
    return fig + (cv.options.title ? 16 : 0);
  },
  (p) => p?.kind === "calheat" && p.days.length > 0,
);

// Tall enough for square cells at the card's width, so a short grid leaves no dead band.
function heatmapCardHeight(cv: ChartValue, w: number): number {
  if (cv.payload?.kind !== "heatmap") return 170;
  const { z, cols } = cv.payload;
  const longest = cols.reduce((m, c) => Math.max(m, c.length), 0);
  const cell = Math.min(40, Math.max(3, (w - 90) / Math.max(1, cols.length)));
  const colGutter = longest * 5.2 > cell ? Math.min(longest * 5.2, 60) : 14;
  const o = cv.options;
  const extra = colGutter + 8 + (o.title ? 16 : 0) + (o.xlabel ? 14 : 0);
  return Math.round(Math.max(90, Math.min(320, z.length * cell + extra)));
}

export const HeatmapComponent = makeFigureComponent<HeatmapNode>(
  heatmapCardHeight,
  (p) => p?.kind === "heatmap" && p.z.some((r) => r.some((v) => v != null)),
);

// A real component, since it owns a useState hook; the toggle slots above the inputs (the Gauge pattern).
function ProportionControls({ data }: { data: ProportionNode }) {
  const [op, setOp] = useState<ProportionLayout>(data.op);
  async function pick(next: ProportionLayout) {
    if (next === data.op) return;
    data.setOp(next); // sockets are identical for both layouts — no cable prune
    setOp(next);
    await getOwningView(data.id)?.rerenderNode(data.id);
    await processEdited(data.id);
  }
  return <OpToggle value={op} options={PROPORTION_LAYOUT_OPTIONS} onChange={(s) => void pick(s)} />;
}

export const ProportionComponent = makeFigureComponent<ProportionNode>(
  170,
  (p) => p?.kind === "proportion" && p.values.some((v) => v > 0),
  (data) => <ProportionControls data={data} />,
);

export const QuiverComponent = makeFigureComponent<QuiverNode>(
  190,
  (p) => p?.kind === "quiver" && p.u.length > 0 && (p.u[0]?.length ?? 0) > 0,
);

function UsMapControls({ data }: { data: UsMapNode }) {
  const [scope, setScope] = useState<UsMapScope>(data.scope);
  async function pick(next: UsMapScope) {
    if (next === data.scope) return;
    data.setScope(next); // both scopes take the same sockets
    setScope(next);
    await getOwningView(data.id)?.rerenderNode(data.id);
    await processEdited(data.id);
  }
  return <SegToggle value={scope} options={US_MAP_SCOPE_OPTIONS} onChange={(s) => void pick(s)} />;
}

// The map's frame is 975×610 on All 50 and a little wider on the lower 48; the legend and the notes ride below it.
export const UsMapComponent = makeFigureComponent<UsMapNode>(
  (cv, w) => {
    const p = cv.payload?.kind === "usmap" ? cv.payload : null;
    const extra = (cv.options.title ? 16 : 0) + (p ? legendLines(p.cCats, !!p.cRange, w) * 16 : 0);
    return Math.round(w * (p?.scope === "all50" ? 0.63 : 0.6)) + extra;
  },
  (p) => p?.kind === "usmap",
  (data) => <UsMapControls data={data} />,
);
