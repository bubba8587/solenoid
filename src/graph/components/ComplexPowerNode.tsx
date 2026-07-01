import type { ComplexPowerNode as ComplexPowerNodeType } from "../rete-nodes";
import { formatCxValue } from "../nodes/complex";
import { InlineInputs } from "./inlineInput";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";

export function ComplexPowerComponent({ data, emit }: NodeProps<ComplexPowerNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <ValueDisplay
        value={formatCxValue(data.cachedResult)}
        empty="—"
      />
    </NodeShell>
  );
}
