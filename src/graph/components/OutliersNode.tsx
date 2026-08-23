import { OUTLIER_METHOD_META } from "../rete-nodes";
import type { OutliersNode as OutliersNodeType, OutlierMethod } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, InlineOutputRows, useNodeField, type NodeProps } from "./nodeKit";

const METHODS = (Object.keys(OUTLIER_METHOD_META) as OutlierMethod[]).map((m) => ({
  value: m, label: OUTLIER_METHOD_META[m].label, title: OUTLIER_METHOD_META[m].description,
}));

export function OutliersComponent({ data, emit }: NodeProps<OutliersNodeType>) {
  const [method, setMethod] = useNodeField(data, "method");
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <OpSelect arg value={method} onChange={setMethod} options={METHODS} />
      <InlineInputs node={data} emit={emit} />
      <div className="solenoid-node__section-divider" />
      <InlineOutputRows
        node={data}
        emit={emit}
        rows={[
          { key: "flags", label: "Flags", value: data.cachedFlags },
          { key: "clean", label: "Cleaned", value: data.cachedClean },
        ]}
      />
    </NodeShell>
  );
}
