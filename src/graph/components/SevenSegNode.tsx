import { useSyncExternalStore } from "react";
import type { SevenSegNode as SevenSegNodeType } from "../rete-nodes";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { SevenSegView } from "./chartCanvasViews";
import { ChartChip } from "./ChartChip";
import { collapseStore } from "../collapseStore";

// The 7-Segment card: input rows + the shared SevenSegView (the same renderer a
// Report embed uses, via ChartFigure's `sevenseg` branch). Collapses to the
// [Chart] chip like the other figure nodes.

export function SevenSegComponent({ data, emit }: NodeProps<SevenSegNodeType>) {
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));
  const cv = data.cachedChart;
  const text = cv?.payload?.kind === "sevenseg" ? cv.payload.text : "";
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <div className="solenoid-node__section-divider" />
      {!collapsed && (
        <div className="solenoid-node__display-value" style={{ justifyContent: "center", padding: "6px 0" }}>
          <SevenSegView text={text} width={(data.width ?? 200) - 22} />
        </div>
      )}
      {cv && (
        <div className="solenoid-node__collapsed-only solenoid-node__display-value" style={{ justifyContent: "flex-end" }}>
          <ChartChip value={cv} />
        </div>
      )}
    </NodeShell>
  );
}
