import type { GroupListsNode as GroupListsNodeType } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, ArgSelect, useNodeField, type NodeProps, type OpOption } from "./nodeKit";
import type { GroupByOp } from "../rete-nodes";
import { GROUP_BY_OP_META } from "../rete-nodes";
import { FrameDisplay } from "./FrameDisplay";

// Derived from GROUP_BY_OP_META — the table the search rows read too.
const GROUP_BY_OPTIONS: ReadonlyArray<OpOption<GroupByOp>> = (Object.keys(GROUP_BY_OP_META) as GroupByOp[])
  .map((value) => ({ value, label: GROUP_BY_OP_META[value].label }));

export function GroupListsComponent({ data: node, emit }: NodeProps<GroupListsNodeType>) {
  const [agg, setAgg] = useNodeField(node, "agg");
  return (
    <NodeShell node={node} emit={emit}>
      <InlineInputs node={node} emit={emit} />
      <ArgSelect value={agg} onChange={setAgg} options={GROUP_BY_OPTIONS} />
      <div className="solenoid-node__section-divider" />
      <FrameDisplay frame={node.cachedResult} label={node.label} />
    </NodeShell>
  );
}
