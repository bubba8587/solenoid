import type { TextInputNode as TextInputNodeType } from "../rete-nodes";
import { processGraph } from "../process";
import { NodeShell, type NodeProps } from "./nodeKit";
import { QuotedTextInput } from "./inlineInput";

export function TextInputComponent({ data, emit }: NodeProps<TextInputNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <QuotedTextInput
        variant="value"
        nodeId={data.id}
        value={data.value}
        onChange={(v) => { data.value = v; void processGraph(data.id); }}
      />
    </NodeShell>
  );
}
