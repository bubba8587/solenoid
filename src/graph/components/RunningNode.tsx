import { useState } from "react";
import { RUNNING_OP_META, RUNNING_MODE_OPTIONS } from "../rete-nodes";
import type { RunningNode as RunningNodeType, RunningOp, RunningMode } from "../rete-nodes";
import { processGraph } from "../process";
import { getActiveArea } from "../activeGraph";
import { InlineInputs } from "./inlineInput";
import { NodeShell, ArgSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";
import { SegToggle } from "./SegToggle";
import { dropInputCables } from "./cablePrune";

const OPS = (Object.keys(RUNNING_OP_META) as RunningOp[]).map((op) => ({
  value: op, label: RUNNING_OP_META[op].label,
}));

export function RunningComponent({ data, emit }: NodeProps<RunningNodeType>) {
  const [agg, setAgg] = useNodeField(data, "agg");
  const [mode, setMode] = useState<RunningMode>(data.mode);

  async function pickMode(next: RunningMode) {
    if (next === data.mode) return;
    if (next === "all") await dropInputCables(data.id, ["window"]);
    data.setMode(next);
    setMode(next);
    await getActiveArea()?.rerenderNode(data.id);
    await processGraph();
  }

  return (
    <NodeShell node={data} emit={emit}>
      <SegToggle value={mode} options={RUNNING_MODE_OPTIONS} onChange={(m) => void pickMode(m)} />
      <InlineInputs node={data} emit={emit} />
      <ArgSelect value={agg} onChange={setAgg} options={OPS} />
      <ValueDisplay value={data.cachedList} />
    </NodeShell>
  );
}
