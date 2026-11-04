import { CORREL_OP_META, type CorrelOp, type CorrelNode as CorrelNodeType } from "../nodeClasses";
import { NodeShell, OpSelect, useNodeField, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { ResultDisplay } from "./ResultDisplay";
import { previewed } from "../listPreview";
import { nodeDisplayName } from "../catalogUtils";
import { getOwningView } from "../activeGraph";

const OPS = (Object.keys(CORREL_OP_META) as CorrelOp[]).map((op) => ({ value: op, label: CORREL_OP_META[op].label }));

export function CorrelComponent({ data, emit }: NodeProps<CorrelNodeType>) {
  const [op, setOpField] = useNodeField(data, "op");

  async function pickOp(next: CorrelOp) {
    if (next === data.op) return;
    data.setOp(next);
    await getOwningView(data.id)?.rerenderNode(data.id);
    setOpField(next);
  }

  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={(o) => void pickOp(o)} options={OPS} />
      <ResultDisplay value={previewed(() => data.cachedResult)} label={nodeDisplayName(data)} />
    </NodeShell>
  );
}
