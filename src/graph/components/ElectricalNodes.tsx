import { SegToggle } from "./SegToggle";
import {
  ParallelCombineNode as ParallelCombineNodeType,
  ESeriesNode as ESeriesNodeType,
  AwgNode as AwgNodeType,
  ResistorCodeNode as ResistorCodeNodeType,
  RESISTOR_DIGIT, RESISTOR_MULT, RESISTOR_TOL,
  type ESeriesOp,
} from "../rete-nodes";
import { NodeShell, OpSelect, ArgSelect, InlineOutputRows, useNodeField, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { makeNodeComponent } from "./standardNode";

import { processGraph } from "../process";
import { useState } from "react";

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

// The PHYSICAL band colors (IEC 60062) — information, not decoration, so fixed
// hexes rather than palette tokens.
const BAND_HEX: Record<string, string> = {
  black: "#1c1c1c", brown: "#7a4a21", red: "#c62f2f", orange: "#e07b28",
  yellow: "#e8c02e", green: "#3d8b40", blue: "#2f6bc4", violet: "#8a4fbf",
  gray: "#9a9a9a", white: "#f2f2f2", gold: "#c19a34", silver: "#bfbfbf",
};

const cap = (c: string) => c[0].toUpperCase() + c.slice(1);
const DIGIT_OPTIONS = Object.keys(RESISTOR_DIGIT).map((c) => ({ value: c, label: `${cap(c)} (${RESISTOR_DIGIT[c]})` }));
const MULT_OPTIONS = Object.keys(RESISTOR_MULT).map((c) => ({ value: c, label: `${cap(c)} (×${RESISTOR_MULT[c] >= 1 ? RESISTOR_MULT[c].toLocaleString("en-US") : RESISTOR_MULT[c]})` }));
const TOL_OPTIONS = Object.keys(RESISTOR_TOL).map((c) => ({ value: c, label: `${cap(c)} (±${RESISTOR_TOL[c]}%)` }));

function ResistorGlyph({ bands }: { bands: string[] }) {
  const n = bands.length;
  const bodyX = 14, bodyW = 92, bodyY = 4, bodyH = 20;
  const xs = bands.map((_, i) =>
    i === n - 1 ? bodyX + bodyW - 16 : bodyX + 12 + i * 16);
  return (
    <svg viewBox="0 0 120 28" style={{ width: "100%", height: 28, display: "block" }} aria-hidden="true">
      <line x1="0" y1="14" x2="120" y2="14" stroke="var(--border)" strokeWidth="2" />
      <rect x={bodyX} y={bodyY} width={bodyW} height={bodyH} rx="7" fill="var(--surface-sunken)" stroke="var(--border)" />
      {bands.map((c, i) => (
        <rect key={i} x={xs[i]} y={bodyY + 1} width="7" height={bodyH - 2} fill={BAND_HEX[c] ?? "var(--border)"} />
      ))}
    </svg>
  );
}

export function ResistorCodeComponent({ data, emit }: NodeProps<ResistorCodeNodeType>) {
  const [bandCount, setBandCount] = useNodeField(data, "bands");
  const [, bump] = useState(0);
  const L = data.stringLiterals;
  const set = (key: string, v: string) => {
    L[key] = v;
    bump((n) => n + 1);
    void processGraph();
  };
  const five = bandCount === "5";
  const bands = five ? [L.b1, L.b2, L.b3, L.mult, L.tol] : [L.b1, L.b2, L.mult, L.tol];
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <SegToggle value={bandCount} options={[{ value: "4", label: "4 band" }, { value: "5", label: "5 band" }]} onChange={setBandCount} />
      <ResistorGlyph bands={bands} />
      <ArgSelect value={L.b1} options={DIGIT_OPTIONS} onChange={(v) => set("b1", v)} />
      <ArgSelect value={L.b2} options={DIGIT_OPTIONS} onChange={(v) => set("b2", v)} />
      {five && <ArgSelect value={L.b3} options={DIGIT_OPTIONS} onChange={(v) => set("b3", v)} />}
      <ArgSelect value={L.mult} options={MULT_OPTIONS} onChange={(v) => set("mult", v)} />
      <ArgSelect value={L.tol} options={TOL_OPTIONS} onChange={(v) => set("tol", v)} />
      <InlineOutputRows
        node={data}
        emit={emit}
        rows={[
          { key: "ohms",      label: "Ω",   value: data.cachedOhms },
          { key: "tolerance", label: "± %", value: data.cachedTol },
        ]}
      />
    </NodeShell>
  );
}
