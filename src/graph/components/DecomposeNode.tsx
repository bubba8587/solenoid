import { DECOMPOSE_MODEL_META } from "../rete-nodes";
import type { DecomposeNode as DecomposeNodeType, DecomposeModel } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, useNodeField, type NodeProps } from "./nodeKit";
import { FrameDisplay } from "./FrameDisplay";

const MODELS = (Object.keys(DECOMPOSE_MODEL_META) as DecomposeModel[]).map((m) => ({
  value: m, label: DECOMPOSE_MODEL_META[m].label, title: DECOMPOSE_MODEL_META[m].description,
}));

export function DecomposeComponent({ data, emit }: NodeProps<DecomposeNodeType>) {
  const [model, setModel] = useNodeField(data, "model");
  return (
    <NodeShell node={data} emit={emit}>
      <OpSelect arg value={model} onChange={setModel} options={MODELS} />
      <InlineInputs node={data} emit={emit} />
      <FrameDisplay frame={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}
