import {
  IsaAtmosphereNode as IsaAtmosphereNodeType,
  AntoineNode as AntoineNodeType,
} from "../nodeClasses";
import { ANTOINE, type AntoineOp } from "../nodes/thermoOps";
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
          { key: "temp",     label: "TEMPERATURE", value: data.cachedT },
          { key: "pressure", label: "PRESSURE", value: data.cachedP },
          { key: "density",  label: "DENSITY", value: data.cachedRho },
          { key: "sound",    label: "SOUND SPEED", value: data.cachedA },
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
          { key: "pressure", label: "PRESSURE", value: data.cachedP },
          { key: "bp",       label: "BOILING POINT", value: data.cachedBp },
        ]}
      />
    </NodeShell>
  );
}
