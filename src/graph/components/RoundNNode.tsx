import type { RoundNNode as RoundNNodeType, RoundNOp } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS: { value: RoundNOp; label: string }[] = [
  { value: "round",     label: "ROUND" },
  { value: "roundup",   label: "ROUNDUP" },
  { value: "rounddown", label: "ROUNDDOWN" },
];

export function RoundNComponent({ data, emit }: NodeProps<RoundNNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
