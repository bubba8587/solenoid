import type { ContainsNode as ContainsNodeType } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";

export function ContainsComponent({ data, emit }: NodeProps<ContainsNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <ValueDisplay value={data.cachedResult} render={(v) => (v === 1 ? "✓ found" : "✗ not found")} />
    </NodeShell>
  );
}
