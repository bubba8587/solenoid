import type { NaNode as NaNodeType } from "../nodeClasses";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";

export function NaComponent({ data, emit }: NodeProps<NaNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
