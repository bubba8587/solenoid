import type { FillNode as FillNodeType, FillOp } from "../rete-nodes";
import { FILL_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

// Op order mirrors the spec: the common fill-with-value first, then the carry
// fills, the statistical imputations, interpolate, drop, and coalesce last.
const OPS: { value: FillOp; label: string }[] =
  (Object.keys(FILL_OP_META) as FillOp[]).map((value) => ({ value, label: FILL_OP_META[value].label }));

export function FillComponent({ data, emit }: NodeProps<FillNodeType>) {
  const [op, setOp] = useNodeField(data, "op");

  // The constant mode shows a "Fill with" input; coalesce shows the "Else" list.
  // Every other mode is single-list — same socket-gating idea as FilterNode.
  const keys = ["list"];
  if (op === "constant") keys.push("value");
  if (op === "coalesce") keys.push("else");

  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} keys={keys} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedList} />
    </NodeShell>
  );
}
