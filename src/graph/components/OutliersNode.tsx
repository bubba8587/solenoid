import { OUTLIER_METHOD_META } from "../rete-nodes";
import type { OutliersNode as OutliersNodeType, OutlierMethod } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, useNodeField, type NodeProps } from "./nodeKit";
import { FrameDisplay } from "./FrameDisplay";

const METHODS = (Object.keys(OUTLIER_METHOD_META) as OutlierMethod[]).map((m) => ({
  value: m, label: OUTLIER_METHOD_META[m].label, title: OUTLIER_METHOD_META[m].description,
}));

export function OutliersComponent({ data, emit }: NodeProps<OutliersNodeType>) {
  const [method, setMethod] = useNodeField(data, "method");
  return (
    <NodeShell node={data} emit={emit}>
      <OpSelect arg value={method} onChange={setMethod} options={METHODS} />
      <InlineInputs node={data} emit={emit} />
      <div className="solenoid-node__section-divider" />
      <FrameDisplay frame={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}
