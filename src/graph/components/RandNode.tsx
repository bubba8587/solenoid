import type { RandBetweenNode as RandNodeType } from "../rete-nodes";
import { RecalcButton } from "./RecalcButton";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";

export function RandComponent({ data, emit }: NodeProps<RandNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <ValueDisplay value={data.cachedResult} />
      <RecalcButton title="Roll a new random value" />
    </NodeShell>
  );
}
