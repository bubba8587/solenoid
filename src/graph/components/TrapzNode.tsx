import { useEffect, useState } from "react";
import { TRAPZ_MODE_META } from "../nodeClasses";
import type { ShapeMode, TrapzNode as TrapzNodeType } from "../nodeClasses";
import { InlineInputs } from "./inlineInput";
import { NodeShell, type NodeProps } from "./nodeKit";
import { ResultDisplay } from "./ResultDisplay";
import { SegToggle } from "./SegToggle";
import { applyShapeMode } from "./shapeMode";
import { nodeDisplayName } from "../catalogUtils";

const MODES = (Object.keys(TRAPZ_MODE_META) as ShapeMode[]).map((m) => ({ value: m, ...TRAPZ_MODE_META[m] }));

export function TrapzComponent({ data, emit }: NodeProps<TrapzNodeType>) {
  // A local mirror, so the toggle re-renders before the socket swap completes.
  const [mode, setMode] = useState<ShapeMode>(data.mode);
  useEffect(() => { setMode(data.mode); }, [data.mode]);
  return (
    <NodeShell node={data} emit={emit}>
      <SegToggle value={mode} options={MODES} onChange={(next) => { setMode(next); void applyShapeMode(data, next); }} />
      <InlineInputs node={data} emit={emit} />
      <ResultDisplay value={data.cachedResult} label={nodeDisplayName(data)} />
    </NodeShell>
  );
}
