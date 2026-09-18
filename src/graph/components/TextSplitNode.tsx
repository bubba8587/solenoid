import type { TextSplitNode as TextSplitNodeType } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";

export function TextSplitComponent({ data, emit }: NodeProps<TextSplitNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <ValueDisplay value={data.cachedResult ?? null} />
    </NodeShell>
  );
}
