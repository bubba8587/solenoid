import type { FrameFromListsNode as FrameFromListsNodeType } from "../nodeClasses";
import { NodeShell, type NodeProps } from "./nodeKit";
import { PairedExtensibleInputs } from "./PairedExtensibleInputs";
import { FrameDisplay } from "./FrameDisplay";
import { nodeDisplayName } from "../catalogUtils";
import { previewed } from "../listPreview";

export function FrameFromListsComponent({ data, emit }: NodeProps<FrameFromListsNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <PairedExtensibleInputs node={data} emit={emit} />
      <FrameDisplay frame={previewed(() => data.cachedResult)} label={nodeDisplayName(data)} />
    </NodeShell>
  );
}
