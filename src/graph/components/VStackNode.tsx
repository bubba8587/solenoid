import type { VStackNode as VStackNodeType } from "../rete-nodes";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { TableDisplay } from "./TableDisplay";

export function VStackComponent({ data, emit }: NodeProps<VStackNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <TableDisplay table={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}
