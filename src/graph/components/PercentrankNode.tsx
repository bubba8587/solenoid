import type { PercentrankNode as PercentrankNodeType, PercentrankMode } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS: { value: PercentrankMode; label: string }[] = [
  { value: "inc", label: "PERCENTRANK.INC" },
  { value: "exc", label: "PERCENTRANK.EXC" },
];

export function PercentrankComponent({ data, emit }: NodeProps<PercentrankNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
