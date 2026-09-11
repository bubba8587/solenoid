import type { ScheduleNode as ScheduleNodeType } from "../rete-nodes";
import { SCHEDULE_MODE_OPTIONS } from "../nodes/schedule";
import { NodeShell, InlineOutputRows, useNodeField, type NodeProps, type OutputRowValue } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { SegToggle } from "./SegToggle";
import { CubeDisplay } from "./CubeDisplay";
import { MeasuredSocketRow } from "./NodeSocket";
import { dateFormatDisplay } from "./valueDisplayFormat";
import { nodeDisplayName } from "../catalogUtils";
import { isCubeValue, isFrameValue } from "../frame";

function ganttSummary(data: ScheduleNodeType): OutputRowValue {
  const g = data.cachedGantt;
  if (typeof g !== "string") return g;
  const out = data.cachedOutput;
  if (!out) return isCubeValue(data.cachedResult) ? g : g;
  const leaves = out.tasks.filter((t) => !t.summary);
  const crit = leaves.filter((t) => t.critical).length;
  return `${leaves.length} task${leaves.length === 1 ? "" : "s"} · ${crit} critical`;
}

function diagnosticsSummary(data: ScheduleNodeType): OutputRowValue {
  const d = data.cachedDiagnostics;
  if (!isFrameValue(d)) return d;
  const n = d.columns[0]?.values.length ?? 0;
  return n === 0 ? "none" : `${n} finding${n === 1 ? "" : "s"}`;
}

// Tasks in, four outputs: the schedule cube (hero), Project finish, Diagnostics and the
// gantt source — the last three as labeled rows so each keeps its own socket dot.
export function ScheduleComponent({ data, emit }: NodeProps<ScheduleNodeType>) {
  const [mode, setMode] = useNodeField(data, "mode");
  const cubeOut = data.outputs.cube;
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <InlineInputs node={data} emit={emit} />
      <SegToggle value={mode} options={SCHEDULE_MODE_OPTIONS} onChange={setMode} />
      {cubeOut && (
        <MeasuredSocketRow hero side="output" socketKey="cube" nodeId={data.id} emit={emit} payload={cubeOut.socket}>
          <div style={{ width: "100%" }}>
            <CubeDisplay cube={data.cachedResult} label={nodeDisplayName(data)} />
          </div>
        </MeasuredSocketRow>
      )}
      <InlineOutputRows
        node={data}
        emit={emit}
        rows={[
          { key: "finish", label: "Project finish", value: dateFormatDisplay(data.cachedFinish, true, false) as OutputRowValue },
          { key: "diagnostics", label: "Diagnostics", value: diagnosticsSummary(data) },
          // The socket carries the full Mermaid source; the row says what it holds.
          { key: "gantt", label: "Gantt", value: ganttSummary(data) },
        ]}
      />
    </NodeShell>
  );
}
