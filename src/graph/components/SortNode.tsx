import type { SortNode as SortNodeType, SortDir } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const DIRS: { value: SortDir; label: string }[] = [
  { value: "asc",  label: "Ascending ↑" },
  { value: "desc", label: "Descending ↓" },
];

export function SortComponent({ data, emit }: NodeProps<SortNodeType>) {
  const [dir, setDir] = useNodeField(data, "dir");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={dir} onChange={setDir} options={DIRS} />
      <ValueDisplay value={data.cachedList} />
    </NodeShell>
  );
}
