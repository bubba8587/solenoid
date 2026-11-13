import type { DateRangeNode as DateRangeNodeType } from "../nodeClasses";
import { serialToJsDate, jsDateToSerial } from "../nodes/date";
import { NodeShell, type NodeProps } from "./nodeKit";
import { MeasuredSocketRow } from "./NodeSocket";
import { processGraph } from "../process";
import { useDraftCommit, INVALID_DRAFT } from "./inlineInput";
// A blank field is null; any day is a date, before 1900 too ([[date-values#Days before 1900]]).
function serialToISO(serial: number | null): string {
  if (serial === null || !Number.isFinite(serial)) return "";
  return serialToJsDate(serial).toISOString().slice(0, 10);
}

function isoToSerial(iso: string): number | null {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : Math.floor(jsDateToSerial(d));
}

function DateField({ serial, onCommit }: { serial: number | null; onCommit: (serial: number | null) => void }) {
  const field = useDraftCommit(
    serial,
    serialToISO,
    (iso) => (iso ? isoToSerial(iso) ?? INVALID_DRAFT : null),
    onCommit,
  );
  return (
    <input
      type="date"
      className="solenoid-node__value-input"
      value={field.draft}
      onChange={(e) => field.setDraft(e.target.value)}
      onBlur={field.onBlur}
      onKeyDown={field.onKeyDown}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    />
  );
}

// Each date input sits on its own output row, so its serial leaves the matching
// socket; the picker IS the readout.
export function DateRangeComponent({ data, emit }: NodeProps<DateRangeNodeType>) {
  const commit = (key: "start" | "end") => (serial: number | null) => {
    data.literals[key] = serial;
    void processGraph(data.id);
  };

  return (
    <NodeShell node={data} emit={emit} collapsible={false} hideOutputSockets>
      <MeasuredSocketRow side="output" socketKey="start" nodeId={data.id} emit={emit} payload={data.outputs.start!.socket}>
        <span className="solenoid-node__io-label">Start</span>
        <DateField serial={data.literals.start} onCommit={commit("start")} />
      </MeasuredSocketRow>
      <MeasuredSocketRow side="output" socketKey="end" nodeId={data.id} emit={emit} payload={data.outputs.end!.socket}>
        <span className="solenoid-node__io-label">End</span>
        <DateField serial={data.literals.end} onCommit={commit("end")} />
      </MeasuredSocketRow>
    </NodeShell>
  );
}
