import type { SwitchNode } from "../rete-nodes";
import { NodeShell, type NodeProps } from "./nodeKit";
import { PairedExtensibleInputs } from "./PairedExtensibleInputs";
import { ResultDisplay } from "./ResultDisplay";
import { nodeDisplayName } from "../catalogUtils";

export function SwitchComponent({ data, emit }: NodeProps<SwitchNode>) {
  return (
    <NodeShell node={data} emit={emit}>
      <PairedExtensibleInputs
        node={data}
        emit={emit}
        leadingKeys={["expr"]}
        trailingKeys={["default"]}
      />
      <ResultDisplay value={data.cachedResult} label={nodeDisplayName(data)} />
    </NodeShell>
  );
}
