import { DECOMPOSE_MODEL_META } from "../rete-nodes";
import type { DecomposeNode as DecomposeNodeType, DecomposeModel } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, InlineOutputRows, useNodeField, type NodeProps } from "./nodeKit";

const MODELS = (Object.keys(DECOMPOSE_MODEL_META) as DecomposeModel[]).map((m) => ({
  value: m, label: DECOMPOSE_MODEL_META[m].label, title: DECOMPOSE_MODEL_META[m].description,
}));

export function DecomposeComponent({ data, emit }: NodeProps<DecomposeNodeType>) {
  const [model, setModel] = useNodeField(data, "model");
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <OpSelect arg value={model} onChange={setModel} options={MODELS} />
      <InlineInputs node={data} emit={emit} />
      <div className="solenoid-node__section-divider" />
      <InlineOutputRows
        node={data}
        emit={emit}
        rows={[
          { key: "trend", label: "Trend", value: data.cachedTrend },
          { key: "seasonal", label: "Seasonal", value: data.cachedSeasonal },
          { key: "residual", label: "Residual", value: data.cachedResidual },
        ]}
      />
    </NodeShell>
  );
}
