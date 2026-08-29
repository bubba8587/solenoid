// Cards for the pack tool nodes — the domain logic lives in their node files.

import {
  EmSpectrumNode as EmSpectrumNodeType,
  HrZonesNode as HrZonesNodeType,
  PipeRoughnessNode as PipeRoughnessNodeType,
  TriangleSolverNode as TriangleSolverNodeType,
  PIPE_ROUGHNESS,
  type TriangleSolved,
} from "../rete-nodes";
import { NodeShell, ArgSelect, InlineOutputRows, useNodeField, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { makeNodeComponent } from "./standardNode";
import { EquationVarRow, EquationOutRow } from "./EquationNode";
import type { DisplayValue } from "./valueDisplayFormat";

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

// The solved triangle, drawn to scale: vertex A opposite side a, B at the origin,
// C along the base.
function TriangleFigure({ t }: { t: Partial<TriangleSolved> }) {
  const { a, c, B } = t;
  if (typeof a !== "number" || typeof c !== "number" || typeof B !== "number") return null;
  const W = 200, H = 108, PAD = 16;
  // Raw vertices (y up): B origin, C along the base, A up from B by angle B.
  const raw = {
    B: { x: 0, y: 0 },
    C: { x: a, y: 0 },
    A: { x: c * Math.cos((B * Math.PI) / 180), y: c * Math.sin((B * Math.PI) / 180) },
  };
  const xs = Object.values(raw).map((p) => p.x);
  const ys = Object.values(raw).map((p) => p.y);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  if (!(spanX > 0) || !Number.isFinite(spanX) || !Number.isFinite(spanY)) return null;
  const scale = Math.min((W - 2 * PAD) / spanX, (H - 2 * PAD) / Math.max(spanY, spanX * 0.15));
  const px = (p: { x: number; y: number }) => ({
    x: PAD + (p.x - Math.min(...xs)) * scale + (W - 2 * PAD - spanX * scale) / 2,
    y: H - PAD - (p.y - Math.min(...ys)) * scale, // flip: SVG y runs down
  });
  const P = { A: px(raw.A), B: px(raw.B), C: px(raw.C) };
  const centroid = {
    x: (P.A.x + P.B.x + P.C.x) / 3,
    y: (P.A.y + P.B.y + P.C.y) / 3,
  };
  // Vertex letters sit just OUTSIDE their corner, pushed away from the centroid.
  const labelAt = (p: { x: number; y: number }) => {
    const dx = p.x - centroid.x, dy = p.y - centroid.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * 9, y: p.y + (dy / len) * 9 };
  };
  const mid = (p: { x: number; y: number }, q: { x: number; y: number }) => {
    const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    const dx = m.x - centroid.x, dy = m.y - centroid.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: m.x + (dx / len) * 8, y: m.y + (dy / len) * 8 };
  };
  const sideLabels = [
    { key: "a", at: mid(P.B, P.C) },
    { key: "b", at: mid(P.A, P.C) },
    { key: "c", at: mid(P.A, P.B) },
  ];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H, display: "block" }} aria-hidden="true">
      <polygon
        points={`${P.A.x},${P.A.y} ${P.B.x},${P.B.y} ${P.C.x},${P.C.y}`}
        fill="none"
        stroke="var(--text-muted)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {(["A", "B", "C"] as const).map((k) => {
        const at = labelAt(P[k]);
        return (
          <text key={k} x={at.x} y={at.y} fontSize="10" fill="var(--text)" textAnchor="middle" dominantBaseline="middle">{k}</text>
        );
      })}
      {sideLabels.map(({ key, at }) => (
        <text key={key} x={at.x} y={at.y} fontSize="9" fill="var(--text-muted)" textAnchor="middle" dominantBaseline="middle">{key}</text>
      ))}
    </svg>
  );
}

const TRIANGLE_KEYS = ["a", "b", "c", "A", "B", "C"] as const;

// The Equation design applied to the triangle: every part is ONE hero row, input
// socket left, output socket right.
export function TriangleSolverComponent({ data, emit }: NodeProps<TriangleSolverNodeType>) {
  const v = data.cachedValues;
  // The figure draws ONE triangle — index 0 when parts are broadcast lists.
  const scalarPart = (val: unknown): number | undefined => {
    const cell = Array.isArray(val) ? val[0] : val;
    return typeof cell === "number" ? cell : undefined;
  };
  const figureParts = Object.fromEntries(
    TRIANGLE_KEYS.map((k) => [k, scalarPart(v[k])]),
  ) as Partial<TriangleSolved>;
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <TriangleFigure t={figureParts} />
      {TRIANGLE_KEYS.map((k) => (
        <EquationVarRow
          key={k}
          node={data}
          emit={emit}
          varKey={k}
          label={k.toUpperCase() === k ? `${k} °` : k}
          value={(v[k] ?? null) as DisplayValue}
          solved={data.solvedKeys.has(k)}
        />
      ))}
      <EquationOutRow node={data} emit={emit} socketKey="area" label="Area" value={data.cachedArea as DisplayValue} />
      <EquationOutRow node={data} emit={emit} socketKey="perimeter" label="Perimeter" value={data.cachedPerimeter as DisplayValue} />
      <EquationOutRow node={data} emit={emit} socketKey="valid" label="Valid" value={data.cachedValid as DisplayValue} />
    </NodeShell>
  );
}
