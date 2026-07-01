import type { GroupByNode as GroupByNodeType } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, InlineOutputRows, useNodeField, type NodeProps, type OpOption } from "./nodeKit";
import type { GroupByOp } from "../rete-nodes";

const GROUP_BY_OPTIONS: ReadonlyArray<OpOption<GroupByOp>> = [
  { value: "sum",   label: "SUM" },
  { value: "avg",   label: "AVERAGE" },
  { value: "min",   label: "MIN" },
  { value: "max",   label: "MAX" },
  { value: "count", label: "COUNT" },
];

export function GroupByComponent({ data: node, emit }: NodeProps<GroupByNodeType>) {
  const [op, setOp] = useNodeField(node, "op");
  const groupCount = node.cachedKeys?.length ?? null;

  return (
    <NodeShell node={node} emit={emit} hideOutputSockets>
      <InlineInputs node={node} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={GROUP_BY_OPTIONS} />
      <div className="solenoid-node__section-divider" />
      <InlineOutputRows
        node={node}
        emit={emit}
        rows={[
          { key: "keys",   label: "Keys",       value: groupCount },
          { key: "values", label: "Aggregated",  value: groupCount },
        ]}
      />
    </NodeShell>
  );
}
