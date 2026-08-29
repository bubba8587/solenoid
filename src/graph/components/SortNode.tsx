import type { SortNode as SortNodeType, SortDir } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, ArgSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const DIRS: { value: SortDir; label: string }[] = [
  { value: "asc",  label: "Ascending ↑" },
  { value: "desc", label: "Descending ↓" },
];

export function SortComponent({ data, emit }: NodeProps<SortNodeType>) {
  const [order, setOrder] = useNodeField(data, "order");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <ArgSelect value={order} onChange={setOrder} options={DIRS} />
      <ValueDisplay value={data.cachedList} />
    </NodeShell>
  );
}
