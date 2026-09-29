import { useEffect, useSyncExternalStore } from "react";
import type { GanttNode as GanttNodeType } from "../rete-nodes";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { ChartChip } from "./ChartChip";
import { isSolError } from "../errorValue";
import { registerChartSvgProvider } from "../canvasCapture";
import { ganttSvg } from "@solenoid/gantt-layout";
import { CardSection, useRowsInUse } from "./CardSection";
import { GANTT_DEFAULT_LITERALS } from "../nodes/gantt";
import { collapseStore } from "../collapseStore";

const GANTT_EXPORT_W = 1000;
const CALENDAR_KEYS = ["holidays", "weekend_code"];

export function GanttComponent({ data, emit }: NodeProps<GanttNodeType>) {
  const cv = data.cachedChart;
  const chart = cv && !isSolError(cv) ? cv : null;
  const payload = chart?.payload?.kind === "gantt" ? chart.payload : null;
  const calendar = useRowsInUse(data, CALENDAR_KEYS, GANTT_DEFAULT_LITERALS);
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));

  // Registered under its own node id, so a Report exports the whole chart with no mounted figure.
  useEffect(() => {
    if (!payload) return;
    return registerChartSvgProvider(data.id, () => ganttSvg(payload, { width: GANTT_EXPORT_W }));
  }, [data.id, payload]);

  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} keys={collapsed ? undefined : ["schedule", "baseline", "status", "options"]} />
      {!collapsed && (
        <CardSection label="Calendar" collapsible defaultOpen={calendar} sockets={{ node: data, emit, keys: CALENDAR_KEYS }}>
          <InlineInputs node={data} emit={emit} keys={CALENDAR_KEYS} />
        </CardSection>
      )}
      <div className="solenoid-node__section-divider" />
      {chart
        ? <div className="solenoid-node__display-value solenoid-node__display-value--chip"><ChartChip value={chart} /></div>
        : <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>}
    </NodeShell>
  );
}
