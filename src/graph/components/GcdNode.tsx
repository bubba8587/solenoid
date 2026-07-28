import type { GcdNode as GcdNodeType, GcdOp } from "../rete-nodes";
import { GCD_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(GCD_OP_META) as GcdOp[]).map((op) => ({
  value: op,
  label: GCD_OP_META[op].label,
}));

export function GcdComponent({ data, emit }: NodeProps<GcdNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
