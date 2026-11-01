// [[C26]] opArgDistinct
import type { ShuffleNode as ShuffleNodeType, ShuffleOp } from "../nodeClasses";
import { SHUFFLE_OP_META } from "../nodeClasses";
import { InlineInputs } from "./inlineInput";
import { NodeShell, useNodeField, type NodeProps } from "./nodeKit";
import { OpToggle } from "./SegToggle";
import { RecalcButton } from "./RecalcButton";
import { ResultDisplay } from "./ResultDisplay";
import { previewed } from "../listPreview";
import { nodeDisplayName } from "../catalogUtils";

const OPTIONS = (Object.keys(SHUFFLE_OP_META) as ShuffleOp[]).map((value) => ({ value, label: SHUFFLE_OP_META[value].label }));

/** Shuffle (each item once) or Sample (draws with replacement); Count shows only under Sample. */
export function ShuffleComponent({ data, emit }: NodeProps<ShuffleNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <OpToggle value={op} options={OPTIONS} onChange={setOp} />
      <InlineInputs node={data} emit={emit} keys={op === "sample" ? ["list", "count", "weights"] : ["list", "weights"]} />
      <ResultDisplay value={previewed(() => data.cachedList)} label={nodeDisplayName(data)} />
      <RecalcButton title={op === "sample" ? "Draw again" : "Shuffle again"} />
    </NodeShell>
  );
}
