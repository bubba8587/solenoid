import { useEffect } from "react";
import type { GanttNode as GanttNodeType } from "../rete-nodes";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { ChartChip } from "./ChartChip";
import { isSolError } from "../errorValue";
import { registerChartSvgProvider } from "../canvasCapture";
import { ganttSvg } from "@solenoid/gantt-layout";

// A width the serialized/exported Gantt draws at, independent of any on-screen size.
const GANTT_EXPORT_W = 1000;

// The card never draws the timeline — squished at card width it reads as noise
// (oneRecordNode). The hero box holds the [Chart] chip; the figure draws where the
// chart output lands: a resizable Display, the popup, a Report embed.
export function GanttComponent({ data, emit }: NodeProps<GanttNodeType>) {
  const cv = data.cachedChart;
  const chart = cv && !isSolError(cv) ? cv : null;
  const payload = chart?.payload?.kind === "gantt" ? chart.payload : null;

  // The figure isn't drawn on this card, but the card CAN serialize it — so it
  // registers the export SVG provider under its OWN node id (canvasCapture's
  // data-chart-svg-provider seam). A Report referencing this node then exports the
  // whole chart (webpage + Obsidian raster) via ganttSvg, with no mounted figure.
  useEffect(() => {
    if (!payload) return;
    return registerChartSvgProvider(data.id, () => ganttSvg(payload, { width: GANTT_EXPORT_W }));
  }, [data.id, payload]);

  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} keys={["schedule", "baseline", "holidays", "weekend_code", "status", "options"]} />
      <div className="solenoid-node__section-divider" />
      {chart
        ? <div className="solenoid-node__display-value" style={{ justifyContent: "flex-end" }}><ChartChip value={chart} /></div>
        : <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>}
    </NodeShell>
  );
}
