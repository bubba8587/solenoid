import type { SortNode as SortNodeType, SortDir } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const DIRS: { value: SortDir; label: string }[] = [
  { value: "asc",  label: "Ascending ↑" },
  { value: "desc", label: "Descending ↓" },
];

export function SortComponent({ data, emit }: NodeProps<SortNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect arg value={op} onChange={setOp} options={DIRS} />
      <ValueDisplay value={data.cachedList} />
    </NodeShell>
  );
}
