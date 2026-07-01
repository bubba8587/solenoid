import type { TBillNode as TBillNodeType, TBillOp } from "../rete-nodes";
import { TBILL_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(TBILL_OP_META) as TBillOp[]).map(op => ({
  value: op, label: TBILL_OP_META[op].label,
}));

export function TBillComponent({ data, emit }: NodeProps<TBillNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  const [, setLabel] = useNodeField(data, "label");
  function handleOp(next: TBillOp) {
    setOp(next);
    setLabel(TBILL_OP_META[next].label);
  }
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={handleOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
