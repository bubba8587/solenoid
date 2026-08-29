import { useState } from "react";
import { BIN_MODE_OPTIONS } from "../rete-nodes";
import type { BinNode as BinNodeType, BinMode } from "../rete-nodes";
import { processGraph } from "../process";
import { getActiveArea } from "../activeGraph";
import { InlineInputs } from "./inlineInput";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";
import { SegToggle } from "./SegToggle";
import { dropInputCables } from "./cablePrune";

export function BinComponent({ data, emit }: NodeProps<BinNodeType>) {
  const [mode, setMode] = useState<BinMode>(data.mode);

  async function pickMode(next: BinMode) {
    if (next === data.mode) return;
    await dropInputCables(data.id, [next === "quantiles" ? "breaks" : "n"]);
    data.setMode(next);
    setMode(next);
    await getActiveArea()?.rerenderNode(data.id);
    await processGraph();
  }

  return (
    <NodeShell node={data} emit={emit}>
      <SegToggle value={mode} options={BIN_MODE_OPTIONS} onChange={(m) => void pickMode(m)} />
      <InlineInputs node={data} emit={emit} />
      <ValueDisplay value={data.cachedList} />
    </NodeShell>
  );
}
