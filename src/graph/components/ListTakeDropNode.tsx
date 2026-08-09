import { LIST_TAKEDROP_OP_META } from "../rete-nodes";
import type { ListTakeDropNode as ListTakeDropNodeType, ListTakeDropOp, TakeDir } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";
import type { DisplayValue } from "./valueDisplayFormat";

const OPS = (Object.keys(LIST_TAKEDROP_OP_META) as ListTakeDropOp[]).map((op) => ({
  value: op,
  label: LIST_TAKEDROP_OP_META[op].label,
}));

const DIRS: { value: TakeDir; label: string }[] = [
  { value: "first", label: "first N" },
  { value: "last",  label: "last N"  },
];

export function ListTakeDropComponent({ data, emit }: NodeProps<ListTakeDropNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  const [dir, setDir] = useNodeField(data, "dir");
  return (
    <NodeShell node={data} emit={emit}>
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <InlineInputs node={data} emit={emit} />
      <OpSelect arg value={dir} onChange={setDir} options={DIRS} />
      <ValueDisplay value={data.cachedList as DisplayValue} />
    </NodeShell>
  );
}
