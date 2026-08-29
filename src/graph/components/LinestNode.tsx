import { useState } from "react";
import type { LinestNode as LinestNodeType, FitOp } from "../rete-nodes";
import { FIT_OP_OPTIONS } from "../rete-nodes";
import { processGraph } from "../process";
import { getActiveArea } from "../activeGraph";
import { InlineInputs } from "./inlineInput";
import { NodeShell, InlineOutputRows, type NodeProps } from "./nodeKit";
import { OpToggle } from "./SegToggle";

export function LinestComponent({ data, emit }: NodeProps<LinestNodeType>) {
  const [op, setOp] = useState<FitOp>(data.op);

  async function pickOp(next: FitOp) {
    if (next === data.op) return;
    data.setOp(next);
    setOp(next);
    await getActiveArea()?.rerenderNode(data.id);
    await processGraph();
  }

  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <OpToggle value={op} options={FIT_OP_OPTIONS} onChange={(s) => void pickOp(s)} />
      <InlineInputs node={data} emit={emit} />
      <div className="solenoid-node__section-divider" />
      <InlineOutputRows
        node={data}
        emit={emit}
        rows={[
          { key: "slope",     label: data.outputs.slope?.label     ?? "Slope",     value: data.cachedSlope     },
          { key: "intercept", label: data.outputs.intercept?.label ?? "Intercept", value: data.cachedIntercept },
          { key: "r2",        label: data.outputs.r2?.label        ?? "R²",        value: data.cachedR2        },
        ]}
      />
    </NodeShell>
  );
}
