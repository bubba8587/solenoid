import { RANK_PERCENTILE_OP_META } from "../rete-nodes";
import type { RankPercentileNode as RankPercentileNodeType, RankPercentileOp } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";
import { dropInputCables } from "./cablePrune";
import { getActiveArea } from "../activeGraph";

const OPS = (Object.keys(RANK_PERCENTILE_OP_META) as RankPercentileOp[]).map((op) => ({
  value: op,
  label: RANK_PERCENTILE_OP_META[op].label,
}));

export function RankPercentileComponent({ data, emit }: NodeProps<RankPercentileNodeType>) {
  const [op, setOpField] = useNodeField(data, "op");

  async function pickOp(next: RankPercentileOp) {
    if (next === data.op) return;
    const departing = data.keysDroppedBySwitch(next);
    if (departing.length > 0) await dropInputCables(data.id, departing);
    data.setOp(next);
    await getActiveArea()?.update("node", data.id);
    setOpField(next);
  }

  return (
    <NodeShell node={data} emit={emit}>
      <OpSelect value={op} onChange={(o) => void pickOp(o)} options={OPS} />
      <InlineInputs node={data} emit={emit} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
