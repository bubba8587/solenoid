import type { ComplexFromNode as ComplexFromNodeType } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";

export function ComplexFromComponent({ data, emit }: NodeProps<ComplexFromNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <ValueDisplay
        value={data.cachedResult}
        empty="—"
      />
    </NodeShell>
  );
}
