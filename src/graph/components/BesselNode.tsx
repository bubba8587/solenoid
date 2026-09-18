import type { BesselNode as BesselNodeType, BesselOp } from "../rete-nodes";
import { BESSEL_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(BESSEL_OP_META) as BesselOp[]).map(op => ({
  value: op, label: BESSEL_OP_META[op].label,
}));

export function BesselComponent({ data, emit }: NodeProps<BesselNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  const [, setLabel] = useNodeField(data, "label");
  function handleOp(next: BesselOp) {
    setOp(next);
    setLabel(BESSEL_OP_META[next].label);
  }
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={handleOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
