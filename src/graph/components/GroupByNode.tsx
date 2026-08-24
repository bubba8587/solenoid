import type { GroupByNode as GroupByNodeType } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, useNodeField, type NodeProps, type OpOption } from "./nodeKit";
import type { GroupByOp } from "../rete-nodes";
import { GROUP_BY_OP_META } from "../rete-nodes";
import { FrameDisplay } from "./FrameDisplay";

// Derived from GROUP_BY_OP_META (declareOnce) — the table the search rows read too.
const GROUP_BY_OPTIONS: ReadonlyArray<OpOption<GroupByOp>> = (Object.keys(GROUP_BY_OP_META) as GroupByOp[])
  .map((value) => ({ value, label: GROUP_BY_OP_META[value].label }));

export function GroupByComponent({ data: node, emit }: NodeProps<GroupByNodeType>) {
  const [op, setOp] = useNodeField(node, "op");
  return (
    <NodeShell node={node} emit={emit}>
      <InlineInputs node={node} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={GROUP_BY_OPTIONS} />
      <div className="solenoid-node__section-divider" />
      <FrameDisplay frame={node.cachedResult} label={node.label} />
    </NodeShell>
  );
}
