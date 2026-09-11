import type { GanttNode as GanttNodeType } from "../rete-nodes";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { ChartChip } from "./ChartChip";
import { isSolError } from "../errorValue";

// The card never draws the timeline — squished at card width it reads as noise
// (oneRecordNode). The hero box holds the [Chart] chip; the figure draws where the
// chart output lands: a resizable Display, the popup, a Report embed.
export function GanttComponent({ data, emit }: NodeProps<GanttNodeType>) {
  const cv = data.cachedChart;
  const chart = cv && !isSolError(cv) ? cv : null;
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} keys={["schedule", "baseline", "holidays", "weekend_code", "options"]} />
      <div className="solenoid-node__section-divider" />
      {chart
        ? <div className="solenoid-node__display-value" style={{ justifyContent: "flex-end" }}><ChartChip value={chart} /></div>
        : <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>}
    </NodeShell>
  );
}
