import {
  IsaAtmosphereNode as IsaAtmosphereNodeType,
  AntoineNode as AntoineNodeType,
  ANTOINE,
  type AntoineOp,
} from "../rete-nodes";
import { NodeShell, ArgSelect, InlineOutputRows, useNodeField, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";

export function IsaAtmosphereComponent({ data, emit }: NodeProps<IsaAtmosphereNodeType>) {
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <InlineInputs node={data} emit={emit} />
      <InlineOutputRows
        node={data}
        emit={emit}
        rows={[
          { key: "temp",     label: "T (K)",  value: data.cachedT },
          { key: "pressure", label: "P (PA)", value: data.cachedP },
          { key: "density",  label: "KG/M³",  value: data.cachedRho },
          { key: "sound",    label: "A (M/S)", value: data.cachedA },
        ]}
      />
    </NodeShell>
  );
}

const ANTOINE_OPS = (Object.entries(ANTOINE) as [AntoineOp, (typeof ANTOINE)[AntoineOp]][]).map(
  ([value, meta]) => ({ value, label: meta.label }),
);

export function AntoineComponent({ data, emit }: NodeProps<AntoineNodeType>) {
  const [substance, setSubstance] = useNodeField(data, "substance");
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <InlineInputs node={data} emit={emit} />
      <ArgSelect value={substance} onChange={setSubstance} options={ANTOINE_OPS} />
      <InlineOutputRows
        node={data}
        emit={emit}
        rows={[
          { key: "pressure", label: "P (PA)",     value: data.cachedP },
          { key: "bp",       label: "BOILING °C", value: data.cachedBp },
        ]}
      />
    </NodeShell>
  );
}
