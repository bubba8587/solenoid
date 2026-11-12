import { useEffect, useState, useSyncExternalStore } from "react";
import { CardSection, useRowsInUse } from "./CardSection";
import { collapseStore } from "../collapseStore";
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
  // The thresholds are optional (blank is none), so they fold; the series itself stays out.
  const optionKeys = ["height", "distance", "prominence"].filter((k) => data.inputs[k]);
  const thresholdsSet = useRowsInUse(data, optionKeys);
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));
  return (
    <NodeShell node={data} emit={emit}>
      <SegToggle value={mode} options={MODES} onChange={(next) => { setMode(next); void applyShapeMode(data, next); }} />
      <InlineInputs node={data} emit={emit} keys={collapsed ? undefined : [mode === "grid" ? "grid" : "list"]} />
      {!collapsed && (
        <CardSection label="Thresholds" collapsible defaultOpen={thresholdsSet} sockets={{ node: data, emit, keys: optionKeys }}>
          <InlineInputs node={data} emit={emit} keys={optionKeys} />
        </CardSection>
      )}
      <div className="solenoid-node__section-divider" />
      <FrameDisplay frame={previewed(() => data.cachedResult)} label={nodeDisplayName(data)} />
    </NodeShell>
  );
}
