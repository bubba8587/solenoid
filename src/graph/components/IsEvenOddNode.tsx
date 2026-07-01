import type { IsEvenOddNode as IsEvenOddNodeType, ParityOp } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS: { value: ParityOp; label: string }[] = [
  { value: "iseven", label: "ISEVEN" },
  { value: "isodd",  label: "ISODD" },
];

export function IsEvenOddComponent({ data, emit }: NodeProps<IsEvenOddNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
