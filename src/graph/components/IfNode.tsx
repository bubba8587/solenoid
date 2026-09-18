import type { IfNode as IfNodeType } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";
import type { DisplayValue } from "./valueDisplayFormat";

export function IfComponent({ data, emit }: NodeProps<IfNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <ValueDisplay value={data.cachedResult as DisplayValue} />
    </NodeShell>
  );
}
