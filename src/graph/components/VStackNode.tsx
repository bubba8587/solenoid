import type { VStackNode as VStackNodeType } from "../rete-nodes";
import { nodeOutputElemFamily } from "./valueDisplayFormat";
import { NodeShell, type NodeProps } from "./nodeKit";
import { ExtensibleInputs } from "./ExtensibleInputs";
import { TableDisplay } from "./TableDisplay";

export function VStackComponent({ data, emit }: NodeProps<VStackNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <ExtensibleInputs node={data} emit={emit} />
      <TableDisplay table={data.cachedResult} label={data.label} elem={nodeOutputElemFamily(data.id)} />
    </NodeShell>
  );
}
