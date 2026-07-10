import type { FrameFromListsNode as FrameFromListsNodeType } from "../rete-nodes";
import { NodeShell, type NodeProps } from "./nodeKit";
import { PairedExtensibleInputs } from "./PairedExtensibleInputs";
import { FrameDisplay } from "./FrameDisplay";

export function FrameFromListsComponent({ data, emit }: NodeProps<FrameFromListsNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <PairedExtensibleInputs node={data} emit={emit} />
      <FrameDisplay frame={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}
