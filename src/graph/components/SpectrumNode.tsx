import type { SpectrumNode } from "../nodeClasses";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { TableDisplay } from "./TableDisplay";
import { nodeDisplayName } from "../catalogUtils";

export function SpectrumComponent({ data, emit }: NodeProps<SpectrumNode>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <TableDisplay table={data.cachedResult} label={nodeDisplayName(data)} elem="number" />
    </NodeShell>
  );
}
