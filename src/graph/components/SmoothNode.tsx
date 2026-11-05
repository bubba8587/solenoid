import { useEffect, useState } from "react";
import { SMOOTH_MODE_META, SMOOTH_OP_META } from "../nodeClasses";
import type { ShapeMode, SmoothNode as SmoothNodeType, SmoothOp } from "../nodeClasses";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";
import { dropInputCables } from "./cablePrune";
import { getOwningView } from "../activeGraph";
import { SegToggle } from "./SegToggle";
import { TableDisplay } from "./TableDisplay";
import { applyShapeMode } from "./shapeMode";
import { nodeDisplayName } from "../catalogUtils";

const MODES = (Object.keys(SMOOTH_MODE_META) as ShapeMode[]).map((m) => ({ value: m, ...SMOOTH_MODE_META[m] }));
const opsFor = (mode: ShapeMode) => (Object.keys(SMOOTH_OP_META) as SmoothOp[])
  .filter((op) => mode === "list" || SMOOTH_OP_META[op].grid)
  .map((op) => ({ value: op, label: SMOOTH_OP_META[op].label, title: SMOOTH_OP_META[op].description }));

export function SmoothComponent({ data, emit }: NodeProps<SmoothNodeType>) {
  const [op, setOpField] = useNodeField(data, "op");
  // A local mirror, so the toggle re-renders before the socket swap completes.
  const [mode, setMode] = useState<ShapeMode>(data.mode);
  useEffect(() => { setMode(data.mode); }, [data.mode]);
  async function pickOp(next: SmoothOp) {
    if (next === data.op) return;
    const departing = SMOOTH_OP_META[data.op].params.map((p) => p.key).filter((k) => !SMOOTH_OP_META[next].params.some((p) => p.key === k));
    if (departing.length) await dropInputCables(data.id, departing);
    data.setOp(next);
    await getOwningView(data.id)?.rerenderNode(data.id);
    setOpField(next);
  }
  async function pickMode(next: ShapeMode) {
    setMode(next);
    await applyShapeMode(data, next);
    setOpField(data.op);
  }
  return (
    <NodeShell node={data} emit={emit}>
      <OpSelect value={op} onChange={(o) => void pickOp(o)} options={opsFor(mode)} />
      <SegToggle value={mode} options={MODES} onChange={(next) => void pickMode(next)} />
      <InlineInputs node={data} emit={emit} />
      {data.mode === "grid"
        ? <TableDisplay table={data.cachedList as (number | null)[][]} label={nodeDisplayName(data)} elem="number" />
        : <ValueDisplay value={data.cachedList} />}
    </NodeShell>
  );
}
