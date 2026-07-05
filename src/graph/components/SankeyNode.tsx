import type { SankeyNode as SankeyNodeType } from "../rete-nodes";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { SankeyView } from "./chartView";
import { ChartChip } from "./ChartChip";
import type { ChartValue } from "../chartValue";

// Fills the wide card (240) minus body padding — same figure width as Chart.
const W = 218;
const H = 170;

export function SankeyComponent({ data, emit }: NodeProps<SankeyNodeType>) {
  const p = data.cachedPayload;
  const has = !!p && p.values.some((v) => v > 0) && p.sources.length > 0;
  const chartValue: ChartValue = {
    __chart: true, op: "sankey", values: p?.values ?? [], payload: p ?? undefined,
    options: data.chartOptions, title: data.label || "Sankey",
  };
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <div className="solenoid-node__section-divider" />
      <div style={{ height: H, marginTop: 4 }}>
        {has
          ? <SankeyView sources={p!.sources} targets={p!.targets} values={p!.values} width={W} height={H} />
          : <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>}
      </div>
      {/* Collapsed → the hero box shows just the [Chart] chip (opens the popup),
          right-aligned like every other value chip. */}
      <div className="solenoid-node__collapsed-only solenoid-node__display-value" style={{ justifyContent: "flex-end" }}><ChartChip value={chartValue} /></div>
    </NodeShell>
  );
}
