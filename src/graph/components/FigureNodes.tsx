import { useSyncExternalStore } from "react";
import type { ClassicPreset } from "rete";
import type {
  ContourNode, WaterfallNode, CandlestickNode, BoxplotNode,
  CalendarHeatmapNode, WaffleNode, QuiverNode,
} from "../rete-nodes";
import type { ChartValue, ChartPayload } from "../chartValue";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { ChartFigure } from "./chartView";
import { ChartChip } from "./ChartChip";
import { collapseStore } from "../collapseStore";

// ─── The canvas-figure cards ──────────────────────────────────────────────────
// Every one of these nodes is the same card: input rows, a divider, the figure
// (via ChartFigure, so the node and a Report embed render identically), and the
// [Chart] chip when collapsed. The per-node knobs are the figure height and a
// payload emptiness check.

type FigureNode = ClassicPreset.Node & {
  id: string;
  cachedChart: ChartValue | null;
  width: number;
  height: number;
};

function makeFigureComponent<N extends FigureNode>(
  figHeight: number,
  hasData: (p: ChartPayload | undefined) => boolean,
) {
  return function FigureComponent({ data, emit }: NodeProps<N>) {
    const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));
    const cv = data.cachedChart;
    const has = !!cv && hasData(cv.payload);
    const figW = (data.width ?? 240) - 22; // card width minus body padding
    return (
      <NodeShell node={data} emit={emit}>
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

export const ContourComponent = makeFigureComponent<ContourNode>(
  190,
  (p) => p?.kind === "contour" && p.xs.length >= 2 && p.ys.length >= 2
    && p.z.some((r) => r.some((v) => v != null && Number.isFinite(v))),
);

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

export const WaffleComponent = makeFigureComponent<WaffleNode>(
  180,
  (p) => p?.kind === "waffle" && p.values.length > 0,
);

export const QuiverComponent = makeFigureComponent<QuiverNode>(
  190,
  (p) => p?.kind === "quiver" && p.u.length > 0 && (p.u[0]?.length ?? 0) > 0,
);
