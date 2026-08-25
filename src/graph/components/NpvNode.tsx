import { CASHFLOW_OP_OPTIONS } from "../rete-nodes";
import type { NpvNode as NpvNodeType, CashflowOp } from "../rete-nodes";
import { useState } from "react";
import { processGraph } from "../process";
import { getActiveArea } from "../activeGraph";
import { InlineInputs } from "./inlineInput";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";
import { SegToggle } from "./SegToggle";
import { dropInputCables } from "./cablePrune";

export function NpvComponent({ data, emit }: NodeProps<NpvNodeType>) {
  const [op, setOp] = useState<CashflowOp>(data.op);

  async function pickOp(next: CashflowOp) {
    if (next === data.op) return;
    if (next === "periods") await dropInputCables(data.id, ["dates"]);
    data.setOp(next);
    setOp(next);
    await getActiveArea()?.update("node", data.id);
    await processGraph();
  }

  return (
    <NodeShell node={data} emit={emit}>
      <SegToggle value={op} options={CASHFLOW_OP_OPTIONS} onChange={(m) => void pickOp(m)} />
      <InlineInputs node={data} emit={emit} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
