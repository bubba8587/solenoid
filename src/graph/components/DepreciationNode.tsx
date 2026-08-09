import type { DepreciationNode as DepreciationNodeType, DepreciationOp } from "../rete-nodes";
import { DEPRECIATION_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";
import { dropInputCables } from "./cablePrune";
import { getActiveArea } from "../activeGraph";

const OPS = (Object.keys(DEPRECIATION_OP_META) as DepreciationOp[]).map((op) => ({
  value: op,
  label: DEPRECIATION_OP_META[op].label,
}));

export function DepreciationComponent({ data, emit }: NodeProps<DepreciationNodeType>) {
  const [op, setOpField] = useNodeField(data, "op");

  async function pickOp(next: DepreciationOp) {
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
