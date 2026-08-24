import type { SpectrumNode } from "../rete-nodes";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { TableDisplay } from "./TableDisplay";

export function SpectrumComponent({ data, emit }: NodeProps<SpectrumNode>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <TableDisplay table={data.cachedResult} label={data.label} elem="number" />
    </NodeShell>
  );
}
