import { useSyncExternalStore } from "react";
import type { TreemapNode as TreemapNodeType } from "../rete-nodes";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { TreemapView } from "./chartView";
import { ChartChip } from "./ChartChip";
import { collapseStore } from "../collapseStore";
import type { ChartValue } from "../chartValue";

const W = 218;
const H = 170;

export function TreemapComponent({ data, emit }: NodeProps<TreemapNodeType>) {
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));
  const p = data.cachedPayload;
  const has = !!p && p.values.some((v) => v > 0);
  const chartValue: ChartValue = {
    __chart: true, op: "treemap", values: p?.values ?? [], payload: p ?? undefined,
    options: data.chartOptions, title: data.label || "Treemap",
  };
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <div className="solenoid-node__section-divider" />
      <div style={{ height: H, marginTop: 4 }}>
        {has && !collapsed
          ? <TreemapView names={p!.names} values={p!.values} width={W} height={H} />
          : !has && <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>}
      </div>
      {/* Collapsed → the hero box shows just the [Chart] chip (opens the popup),
          right-aligned like every other value chip. */}
      <div className="solenoid-node__collapsed-only solenoid-node__display-value" style={{ justifyContent: "flex-end" }}><ChartChip value={chartValue} /></div>
    </NodeShell>
  );
}
