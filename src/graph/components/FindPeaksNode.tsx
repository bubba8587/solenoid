import type { FindPeaksNode as FindPeaksNodeType } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, type NodeProps } from "./nodeKit";
import { FrameDisplay } from "./FrameDisplay";
import { nodeDisplayName } from "../catalogUtils";

export function FindPeaksComponent({ data, emit }: NodeProps<FindPeaksNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <div className="solenoid-node__section-divider" />
      <FrameDisplay frame={data.cachedResult} label={nodeDisplayName(data)} />
    </NodeShell>
  );
}
