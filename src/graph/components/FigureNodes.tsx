import { useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { ClassicPreset } from "rete";
import type {
  WaterfallNode, CandlestickNode, BoxplotNode,
  CalendarHeatmapNode, ProportionNode, ProportionLayout, QuiverNode,
} from "../rete-nodes";
import { PROPORTION_LAYOUT_OPTIONS } from "../rete-nodes";
import type { ChartValue, ChartPayload } from "../chartValue";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { ChartFigure } from "./chartView";
import { ChartChip } from "./ChartChip";
import { SegToggle } from "./SegToggle";
import { collapseStore } from "../collapseStore";
import { processGraph } from "../process";
import { getActiveArea } from "../activeGraph";

// One shared card for every figure node; the figure comes from ChartFigure, so a
// node and a Report embed render identically.

type FigureNode = ClassicPreset.Node & {
  id: string;
  cachedChart: ChartValue | null;
  width: number;
  height: number;
};

function makeFigureComponent<N extends FigureNode>(
  figHeight: number,
  hasData: (p: ChartPayload | undefined) => boolean,
  controls?: (data: N) => ReactNode,
) {
  return function FigureComponent({ data, emit }: NodeProps<N>) {
    const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));
    const cv = data.cachedChart;
    const has = !!cv && hasData(cv.payload);
    const figW = (data.width ?? 240) - 22; // card width minus body padding
    return (
      <NodeShell node={data} emit={emit}>
        {controls?.(data)}
        <InlineInputs node={data} emit={emit} />
        <div className="solenoid-node__section-divider" />
        {!collapsed && (has && cv
          ? <ChartFigure value={cv} width={figW} height={figHeight} />
          : <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>)}
        {/* Collapsed → the hero box shows just the [Chart] chip (opens the popup). */}
        {cv && (
          <div className="solenoid-node__collapsed-only solenoid-node__display-value" style={{ justifyContent: "flex-end" }}>
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

export const CalendarHeatmapComponent = makeFigureComponent<CalendarHeatmapNode>(
  110,
  (p) => p?.kind === "calheat" && p.days.length > 0,
);

// The layout picker is a real component (it owns the useState hook); the figure card
// itself is the shared one, with the toggle slotted above the inputs (the Gauge pattern).
function ProportionControls({ data }: { data: ProportionNode }) {
  const [op, setOp] = useState<ProportionLayout>(data.op);
  async function pick(next: ProportionLayout) {
    if (next === data.op) return;
    data.setOp(next); // sockets are identical for both layouts — no cable prune
    setOp(next);
    await getActiveArea()?.rerenderNode(data.id);
    await processGraph();
  }
  return <SegToggle value={op} options={PROPORTION_LAYOUT_OPTIONS} onChange={(s) => void pick(s)} />;
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
