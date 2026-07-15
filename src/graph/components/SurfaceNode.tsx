import { useSyncExternalStore } from "react";
import type { SurfaceNode as SurfaceNodeType } from "../rete-nodes";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { ChartFigure } from "./chartView";
import { ChartChip } from "./ChartChip";
import { collapseStore } from "../collapseStore";

// Fills the wide card (240) minus body padding.
const W = 218;
const H = 190;

export function SurfaceComponent({ data, emit }: NodeProps<SurfaceNodeType>) {
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));
  const cv = data.cachedChart;
  const p = cv?.payload?.kind === "surface" ? cv.payload : null;
  const has = !!p && p.xs.length >= 2 && p.ys.length >= 2 && p.z.some((r) => r.some((v) => v != null && Number.isFinite(v)));

  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <div className="solenoid-node__section-divider" />
      <div style={{ height: H, marginTop: 4 }}>
        {has && cv && !collapsed
          ? <ChartFigure value={cv} width={W} height={H} />
          : !has && <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>}
      </div>
      {/* Collapsed → the hero box shows just the [Chart] chip (opens the popup). */}
      {cv && (
        <div className="solenoid-node__collapsed-only solenoid-node__display-value" style={{ justifyContent: "flex-end" }}>
          <ChartChip value={cv} />
        </div>
      )}
    </NodeShell>
  );
}
