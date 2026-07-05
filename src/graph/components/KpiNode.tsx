import type { KpiNode as KpiNodeType } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, type NodeProps } from "./nodeKit";
import { KpiCard } from "./chartCards";

export function KpiComponent({ data, emit }: NodeProps<KpiNodeType>) {
  const payload = data.cachedPayload;
  return (
    <NodeShell node={data} emit={emit} collapsible={false}>
      <InlineInputs node={data} emit={emit} />
      {payload
        ? <KpiCard payload={payload} />
        : <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>}
    </NodeShell>
  );
}
