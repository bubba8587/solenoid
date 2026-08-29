import { CASHFLOW_OP_OPTIONS } from "../rete-nodes";
import type { IrrNode as IrrNodeType, CashflowOp } from "../rete-nodes";
import { useState } from "react";
import { processGraph } from "../process";
import { getActiveArea } from "../activeGraph";
import { InlineInputs } from "./inlineInput";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";
import { OpToggle } from "./SegToggle";
import { dropInputCables } from "./cablePrune";

export function IrrComponent({ data, emit }: NodeProps<IrrNodeType>) {
  const [op, setOp] = useState<CashflowOp>(data.op);

  async function pickOp(next: CashflowOp) {
    if (next === data.op) return;
    if (next === "periods") await dropInputCables(data.id, ["dates"]);
    data.setOp(next);
    setOp(next);
    await getActiveArea()?.rerenderNode(data.id);
    await processGraph();
  }

  return (
    <NodeShell node={data} emit={emit}>
      <OpToggle value={op} options={CASHFLOW_OP_OPTIONS} onChange={(m) => void pickOp(m)} />
      <InlineInputs node={data} emit={emit} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
