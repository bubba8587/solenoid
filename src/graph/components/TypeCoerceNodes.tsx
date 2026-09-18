// T / N / TYPE are covered by Cast + the socket type system + the Test node.
import type { FormatDollarNode as FormatDollarNodeType } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";

export function FormatDollarComponent({ data, emit }: NodeProps<FormatDollarNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <ValueDisplay value={data.cachedText} />
    </NodeShell>
  );
}
