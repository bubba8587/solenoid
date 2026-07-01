import type { SecurityDiscNode as SecurityDiscNodeType, SecurityDiscOp } from "../rete-nodes";
import { SECURITY_DISC_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(SECURITY_DISC_OP_META) as SecurityDiscOp[]).map(op => ({
  value: op, label: SECURITY_DISC_OP_META[op].label,
}));

export function SecurityDiscComponent({ data, emit }: NodeProps<SecurityDiscNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  const [, setLabel] = useNodeField(data, "label");
  function handleOp(next: SecurityDiscOp) {
    setOp(next);
    setLabel(SECURITY_DISC_OP_META[next].label);
  }
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={handleOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
