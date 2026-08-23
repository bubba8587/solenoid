import type { FindPeaksNode as FindPeaksNodeType } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, InlineOutputRows, type NodeProps } from "./nodeKit";

export function FindPeaksComponent({ data, emit }: NodeProps<FindPeaksNodeType>) {
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <InlineInputs node={data} emit={emit} />
      <div className="solenoid-node__section-divider" />
      <InlineOutputRows
        node={data}
        emit={emit}
        rows={[
          { key: "positions", label: "Positions", value: data.cachedPositions },
          { key: "values", label: "Heights", value: data.cachedValues },
        ]}
      />
    </NodeShell>
  );
}
