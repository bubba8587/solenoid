import { BINOM_DIST_OP_META } from "../nodes/dist-discrete";
import type { BinomDistNode as BinomDistNodeType, BinomDistOp } from "../nodes/dist-discrete";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(BINOM_DIST_OP_META) as BinomDistOp[]).map((op) => ({
  value: op,
  label: BINOM_DIST_OP_META[op].label,
}));

export function BinomDistComponent({ data, emit }: NodeProps<BinomDistNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
