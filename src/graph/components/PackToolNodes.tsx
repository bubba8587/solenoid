// Cards for the 2026-07-09 pack tool wave: EM Spectrum Band (electromagnetism),
// Heart-Rate Zones (health), Pipe Roughness (fluids), Triangle Solver
// (geometry). All standard shells — the domain logic lives in their node files.

import {
  EmSpectrumNode as EmSpectrumNodeType,
  HrZonesNode as HrZonesNodeType,
  PipeRoughnessNode as PipeRoughnessNodeType,
  TriangleSolverNode as TriangleSolverNodeType,
  PIPE_ROUGHNESS,
} from "../rete-nodes";
import { NodeShell, OpSelect, InlineOutputRows, useNodeField, type NodeProps } from "./nodeKit";
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
          { key: "band",       label: "BAND", value: data.cachedBand },
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
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <OpSelect value={op} onChange={setOp} options={ROUGHNESS_OPTIONS} />
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

export function TriangleSolverComponent({ data, emit }: NodeProps<TriangleSolverNodeType>) {
  const t = data.cached;
  const err = data.cachedError;
  const out = (k: "a" | "b" | "c" | "A" | "B" | "C" | "area" | "perimeter") =>
    err ?? (t ? t[k] ?? null : null);
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <InlineInputs node={data} emit={emit} keys={["a", "b", "c", "A", "B", "C"]} />
      <InlineOutputRows
        node={data}
        emit={emit}
        rows={[
          { key: "a", label: "a", value: out("a") },
          { key: "b", label: "b", value: out("b") },
          { key: "c", label: "c", value: out("c") },
          { key: "A", label: "A °", value: out("A") },
          { key: "B", label: "B °", value: out("B") },
          { key: "C", label: "C °", value: out("C") },
          { key: "area",      label: "AREA",      value: out("area") },
          { key: "perimeter", label: "PERIMETER", value: out("perimeter") },
        ]}
      />
    </NodeShell>
  );
}
