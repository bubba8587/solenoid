import type { LinestNode as LinestNodeType } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, InlineOutputRows, type NodeProps } from "./nodeKit";

export function LinestComponent({ data, emit }: NodeProps<LinestNodeType>) {
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <InlineInputs node={data} emit={emit} />
      <div className="solenoid-node__section-divider" />
      <InlineOutputRows
        node={data}
        emit={emit}
        rows={[
          { key: "slope",     label: "Slope",     value: data.cachedSlope     },
          { key: "intercept", label: "Intercept", value: data.cachedIntercept },
          { key: "r2",        label: "R²",        value: data.cachedR2        },
        ]}
      />
    </NodeShell>
  );
}
