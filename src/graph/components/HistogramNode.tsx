import { useSyncExternalStore } from "react";
import { HISTOGRAM_MODE_META } from "../rete-nodes";
import type { HistogramNode as HistogramNodeType, HistogramMode } from "../rete-nodes";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { ChartFigure } from "./chartView";
import { ChartChip } from "./ChartChip";
import { SegToggle } from "./SegToggle";
import { dropInputCables } from "./cablePrune";
import { getActiveArea } from "../activeGraph";
import { collapseStore } from "../collapseStore";
import { processGraph } from "../process";

const MODE_OPTIONS = (Object.keys(HISTOGRAM_MODE_META) as HistogramMode[]).map((m) => ({
  value: m, label: HISTOGRAM_MODE_META[m].label, title: HISTOGRAM_MODE_META[m].description,
}));

// Fills the wide card (240) minus body padding.
const W = 218;
const H = 150;

export function HistogramComponent({ data, emit }: NodeProps<HistogramNodeType>) {
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));
  const cv = data.cachedChart;
  const has = !!cv && (cv.op === "contour"
    ? cv.payload?.kind === "contour" && cv.payload.z.length > 0
    : Array.isArray(cv.values) && cv.values.length > 0);

  async function pickMode(next: HistogramMode) {
    if (next === data.mode) return;
    const drop = data.keysDroppedByMode(next);
    if (drop.length) await dropInputCables(data.id, drop);
    data.setMode(next);
    await getActiveArea()?.update("node", data.id);
    await processGraph();
  }

  return (
    <NodeShell node={data} emit={emit}>
      <SegToggle arg value={data.mode} options={MODE_OPTIONS} onChange={(m) => void pickMode(m)} />
      {/* `__figure` so NodeCard centers the `chart` OUTPUT socket on the plot row. */}
      <div className="solenoid-node__figure" style={{ position: "relative", height: H, marginTop: 4 }}>
        {has && cv && !collapsed
          ? <ChartFigure value={cv} width={W} height={H} />
          : <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>}
      </div>
      <div className="solenoid-node__section-divider" />
      <InlineInputs node={data} emit={emit} />
      {/* Collapsed → the hero box shows just the [Chart] chip (opens the popup). */}
      {cv && (
        <div className="solenoid-node__collapsed-only solenoid-node__display-value" style={{ justifyContent: "flex-end" }}>
          <ChartChip value={cv} />
        </div>
      )}
    </NodeShell>
  );
}
