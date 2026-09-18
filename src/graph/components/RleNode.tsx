import type { RleNode } from "../rete-nodes";
import { nodeOutputElemFamily } from "./valueDisplayFormat";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { TableDisplay } from "./TableDisplay";
import { nodeDisplayName } from "../catalogUtils";

export function RleComponent({ data, emit }: NodeProps<RleNode>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <TableDisplay table={data.cachedResult} label={nodeDisplayName(data)} elem={nodeOutputElemFamily(data.id)} />
    </NodeShell>
  );
}
