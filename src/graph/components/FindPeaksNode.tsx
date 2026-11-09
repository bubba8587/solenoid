import { useEffect, useState } from "react";
import type { FindPeaksNode as FindPeaksNodeType, ShapeMode } from "../nodeClasses";
import { FIND_PEAKS_MODE_META } from "../nodeClasses";
import { InlineInputs } from "./inlineInput";
import { NodeShell, type NodeProps } from "./nodeKit";
import { FrameDisplay } from "./FrameDisplay";
import { SegToggle } from "./SegToggle";
import { applyShapeMode } from "./shapeMode";
import { nodeDisplayName } from "../catalogUtils";
import { previewed } from "../listPreview";

const MODES = (Object.keys(FIND_PEAKS_MODE_META) as ShapeMode[]).map((m) => ({ value: m, ...FIND_PEAKS_MODE_META[m] }));

export function FindPeaksComponent({ data, emit }: NodeProps<FindPeaksNodeType>) {
  // A local mirror, so the toggle re-renders before the socket swap completes.
  const [mode, setMode] = useState<ShapeMode>(data.mode);
  useEffect(() => { setMode(data.mode); }, [data.mode]);
  return (
    <NodeShell node={data} emit={emit}>
      <SegToggle value={mode} options={MODES} onChange={(next) => { setMode(next); void applyShapeMode(data, next); }} />
      <InlineInputs node={data} emit={emit} />
      <div className="solenoid-node__section-divider" />
      <FrameDisplay frame={previewed(() => data.cachedResult)} label={nodeDisplayName(data)} />
    </NodeShell>
  );
}
