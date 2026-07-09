import {
  ParallelCombineNode as ParallelCombineNodeType,
  ESeriesNode as ESeriesNodeType,
  AwgNode as AwgNodeType,
  type ESeriesOp,
} from "../rete-nodes";
import { NodeShell, OpSelect, InlineOutputRows, useNodeField, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { makeNodeComponent } from "./standardNode";

export const ParallelCombineComponent =
  makeNodeComponent<ParallelCombineNodeType>((n) => n.cachedResult);

const E_SERIES_OPS: { value: ESeriesOp; label: string }[] = [
  { value: "E3",  label: "E3  (>20%)" },
  { value: "E6",  label: "E6  (20%)" },
  { value: "E12", label: "E12 (10%)" },
  { value: "E24", label: "E24 (5%)" },
  { value: "E48", label: "E48 (2%)" },
  { value: "E96", label: "E96 (1%)" },
];

export function ESeriesComponent({ data, emit }: NodeProps<ESeriesNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={E_SERIES_OPS} />
      <InlineOutputRows
        node={data}
        emit={emit}
        rows={[
          { key: "nearest", label: "NEAREST", value: data.cachedNearest },
          { key: "errpct",  label: "ERROR %", value: data.cachedError },
        ]}
      />
    </NodeShell>
  );
}

export function AwgComponent({ data, emit }: NodeProps<AwgNodeType>) {
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <InlineInputs node={data} emit={emit} />
      <InlineOutputRows
        node={data}
        emit={emit}
        rows={[
          { key: "diameter",   label: "Ø MM",     value: data.cachedDiameter },
          { key: "area",       label: "MM²",      value: data.cachedArea },
          { key: "resistance", label: "Ω/KM",     value: data.cachedResistance },
          { key: "ampacity",   label: "AMPACITY", value: data.cachedAmpacity },
        ]}
      />
    </NodeShell>
  );
}
