import { useState } from "react";
import { ACCRUED_INTEREST_OP_OPTIONS, type AccruedInterestNode as AccruedInterestNodeType, type AccruedInterestOp } from "../rete-nodes";
import { processGraph } from "../process";
import { getActiveView } from "../activeGraph";
import { InlineInputs } from "./inlineInput";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";
import { OpToggle } from "./SegToggle";
import { dropInputCables } from "./cablePrune";

export function AccruedInterestComponent({ data, emit }: NodeProps<AccruedInterestNodeType>) {
  const [op, setOp] = useState<AccruedInterestOp>(data.op);

  async function pickOp(next: AccruedInterestOp) {
    if (next === data.op) return;
    const departing = data.keysDroppedBySwitch(next);
    if (departing.length > 0) await dropInputCables(data.id, departing);
    data.setOp(next);
    setOp(next);
    await getActiveView()?.rerenderNode(data.id);
    await processGraph();
  }

  return (
    <NodeShell node={data} emit={emit}>
      <OpToggle value={op} options={ACCRUED_INTEREST_OP_OPTIONS} onChange={(m) => void pickOp(m)} />
      <InlineInputs node={data} emit={emit} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
