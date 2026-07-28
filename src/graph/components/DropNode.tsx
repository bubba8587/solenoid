import type { DropNode as DropNodeType, DropDir } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";
import type { DisplayValue } from "./valueDisplayFormat";

const OPS: { value: DropDir; label: string }[] = [
  { value: "first", label: "drop first N" },
  { value: "last",  label: "drop last N"  },
];

export function DropComponent({ data, emit }: NodeProps<DropNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect arg value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedList as DisplayValue} />
    </NodeShell>
  );
}
