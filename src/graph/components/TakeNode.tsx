import type { TakeNode as TakeNodeType, TakeDir } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";
import type { DisplayValue } from "./valueDisplayFormat";

const OPS: { value: TakeDir; label: string }[] = [
  { value: "first", label: "take first N" },
  { value: "last",  label: "take last N"  },
];

export function TakeComponent({ data, emit }: NodeProps<TakeNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect arg value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedList as DisplayValue} />
    </NodeShell>
  );
}
