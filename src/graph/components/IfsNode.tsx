import type { IfsNode } from "../nodeClasses";
import { NodeShell, type NodeProps } from "./nodeKit";
import { PairedExtensibleInputs } from "./PairedExtensibleInputs";
import { ResultDisplay } from "./ResultDisplay";
import { nodeDisplayName } from "../catalogUtils";

export function IfsComponent({ data, emit }: NodeProps<IfsNode>) {
  return (
    <NodeShell node={data} emit={emit}>
      <PairedExtensibleInputs node={data} emit={emit} trailingKeys={["otherwise"]} />
      <ResultDisplay value={data.cachedResult} label={nodeDisplayName(data)} />
    </NodeShell>
  );
}
