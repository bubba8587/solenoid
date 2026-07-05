import type { BulletNode as BulletNodeType } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, type NodeProps } from "./nodeKit";
import { BulletBar } from "./chartCards";

export function BulletComponent({ data, emit }: NodeProps<BulletNodeType>) {
  const payload = data.cachedPayload;
  return (
    <NodeShell node={data} emit={emit} collapsible={false}>
      <InlineInputs node={data} emit={emit} />
      {payload
        ? <BulletBar payload={payload} />
        : <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>}
    </NodeShell>
  );
}
