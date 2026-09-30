import type { ChooseNode } from "../rete-nodes";
import { NodeShell, type NodeProps } from "./nodeKit";
import { ExtensibleInputs } from "./ExtensibleInputs";
import { ResultDisplay } from "./ResultDisplay";
import { nodeDisplayName } from "../catalogUtils";

export function ChooseComponent({ data, emit }: NodeProps<ChooseNode>) {
  return (
    <NodeShell node={data} emit={emit}>
      <ExtensibleInputs
        node={data}
        emit={emit}
        leadingKeys={["index"]}
        valueKeys={data.valueInputKeys()}
      />
      <ResultDisplay value={data.cachedResult} label={nodeDisplayName(data)} />
    </NodeShell>
  );
}
