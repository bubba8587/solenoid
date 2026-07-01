import type { QuartileNode as QuartileNodeType, QuartileMode } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS: { value: QuartileMode; label: string }[] = [
  { value: "inc", label: "QUARTILE.INC" },
  { value: "exc", label: "QUARTILE.EXC" },
];

export function QuartileComponent({ data, emit }: NodeProps<QuartileNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
