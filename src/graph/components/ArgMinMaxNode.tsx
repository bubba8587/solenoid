import { ARG_MIN_MAX_OP_META } from "../rete-nodes";
import type { ArgMinMaxNode as ArgMinMaxNodeType, ArgMinMaxOp } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(ARG_MIN_MAX_OP_META) as ArgMinMaxOp[]).map((op) => ({
  value: op,
  label: ARG_MIN_MAX_OP_META[op].label,
}));

export function ArgMinMaxComponent({ data, emit }: NodeProps<ArgMinMaxNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
