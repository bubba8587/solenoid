import type { NotNode as NotNodeType } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";

// NOT: a single input, element-wise logical flip → the logical type.
export function NotComponent({ data, emit }: NodeProps<NotNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
