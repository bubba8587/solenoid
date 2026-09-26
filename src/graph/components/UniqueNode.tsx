import type { UniqueNode as UniqueNodeType } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";
import { SegToggle } from "./SegToggle";
import type { DisplayValue } from "./valueDisplayFormat";

type Axis = "rows" | "cols";
const AXES: { value: Axis; label: string; title: string }[] = [
  { value: "rows", label: "Rows",    title: "Remove repeated rows, as Excel's UNIQUE does" },
  { value: "cols", label: "Columns", title: "Remove repeated columns; a list's items are its columns" },
];
type Keep = "distinct" | "once";
const KEEPS: { value: Keep; label: string; title: string }[] = [
  { value: "distinct", label: "Each once",    title: "Keep one of every distinct row or column" },
  { value: "once",     label: "Only singles", title: "Keep only the rows or columns that appear exactly once" },
];

export function UniqueComponent({ data, emit }: NodeProps<UniqueNodeType>) {
  const [byCol, setByCol] = useNodeField(data, "byCol");
  const [exactlyOnce, setExactlyOnce] = useNodeField(data, "exactlyOnce");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <SegToggle value={byCol ? "cols" : "rows"} options={AXES} onChange={(v) => setByCol(v === "cols")} />
      <SegToggle value={exactlyOnce ? "once" : "distinct"} options={KEEPS} onChange={(v) => setExactlyOnce(v === "once")} />
      <ValueDisplay value={data.cachedList as DisplayValue} />
    </NodeShell>
  );
}
