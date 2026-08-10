import { CASHFLOW_MODE_OPTIONS } from "../rete-nodes";
import type { NpvNode as NpvNodeType, CashflowMode } from "../rete-nodes";
import { useState } from "react";
import { processGraph } from "../process";
import { getActiveArea } from "../activeGraph";
import { InlineInputs } from "./inlineInput";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";
import { SegToggle } from "./SegToggle";
import { dropInputCables } from "./cablePrune";

export function NpvComponent({ data, emit }: NodeProps<NpvNodeType>) {
  const [mode, setMode] = useState<CashflowMode>(data.mode);

  async function pickMode(next: CashflowMode) {
    if (next === data.mode) return;
    if (next === "periods") await dropInputCables(data.id, ["dates"]);
    data.setMode(next);
    setMode(next);
    await getActiveArea()?.update("node", data.id);
    await processGraph();
  }

  return (
    <NodeShell node={data} emit={emit}>
      <SegToggle arg value={mode} options={CASHFLOW_MODE_OPTIONS} onChange={(m) => void pickMode(m)} />
      <InlineInputs node={data} emit={emit} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
