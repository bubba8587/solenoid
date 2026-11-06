// [[C76]] formulaPackDefault, [[C26]] opArgDistinct

import {
  EmSpectrumNode as EmSpectrumNodeType,
  HrZonesNode as HrZonesNodeType,
  PipeRoughnessNode as PipeRoughnessNodeType,
} from "../nodeClasses";
import { PIPE_ROUGHNESS } from "../nodes/fluidsOps";
import { NodeShell, ArgSelect, InlineOutputRows, useNodeField, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { makeNodeComponent } from "./standardNode";

export function EmSpectrumComponent({ data, emit }: NodeProps<EmSpectrumNodeType>) {
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <InlineInputs node={data} emit={emit} />
      <InlineOutputRows
        node={data}
        emit={emit}
        rows={[
          { key: "band",       label: "Band", value: data.cachedBand },
          { key: "freq",       label: "HZ",   value: data.cachedFreq },
          { key: "wavelength", label: "M",    value: data.cachedWavelength },
        ]}
      />
    </NodeShell>
  );
}

export const HrZonesComponent = makeNodeComponent<HrZonesNodeType>((n) => n.cachedFrame);

const ROUGHNESS_OPTIONS = PIPE_ROUGHNESS.map((r) => ({ value: r.id, label: r.label }));

export function PipeRoughnessComponent({ data, emit }: NodeProps<PipeRoughnessNodeType>) {
  const [material, setMaterial] = useNodeField(data, "material");
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <ArgSelect value={material} onChange={setMaterial} options={ROUGHNESS_OPTIONS} />
      <InlineInputs node={data} emit={emit} />
      <InlineOutputRows
        node={data}
        emit={emit}
        rows={[
          { key: "eps", label: "ε MM", value: data.cachedEps },
          { key: "rel", label: "ε/D",  value: data.cachedRel },
        ]}
      />
    </NodeShell>
  );
}

export { TriangleSolverComponent } from "./TriangleSolverCard";
export { UnitCircleComponent } from "./UnitCircleCard";
export { CircleSolverComponent, RegularPolygonComponent, TwoPointsComponent } from "./GeometryCards";
