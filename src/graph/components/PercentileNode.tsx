import type { PercentileNode as PercentileNodeType, PercentileMode } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS: { value: PercentileMode; label: string }[] = [
  { value: "inc", label: "PERCENTILE.INC (0 and 1 inclusive)" },
  { value: "exc", label: "PERCENTILE.EXC (0 and 1 exclusive)" },
];

export function PercentileComponent({ data, emit }: NodeProps<PercentileNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
