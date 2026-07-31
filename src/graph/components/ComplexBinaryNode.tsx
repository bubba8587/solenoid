import type { ComplexBinaryNode as ComplexBinaryNodeType, ComplexBinaryOp } from "../rete-nodes";
import { COMPLEX_BINARY_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(COMPLEX_BINARY_OP_META) as ComplexBinaryOp[]).map((op) => ({
  value: op,
  label: COMPLEX_BINARY_OP_META[op].label,
}));

export function ComplexBinaryComponent({ data, emit }: NodeProps<ComplexBinaryNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <InlineInputs node={data} emit={emit} />
      <ValueDisplay
        value={data.cachedResult}
        empty="—"
      />
    </NodeShell>
  );
}
