import type { DateRangeNode as DateRangeNodeType } from "../rete-nodes";
import { serialToJsDate, jsDateToSerial } from "../nodes/date";
import { NodeShell, type NodeProps } from "./nodeKit";
import { MeasuredSocketRow } from "./NodeSocket";
import { processGraph } from "../process";
import { useDraftCommit, INVALID_DRAFT } from "./inlineInput";
function serialToISO(serial: number): string {
  if (!(serial > 0)) return "";
  return serialToJsDate(serial).toISOString().slice(0, 10);
}

function isoToSerial(iso: string): number {
  if (!iso) return 0;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? 0 : Math.floor(jsDateToSerial(d));
}

function DateField({ serial, onCommit }: { serial: number; onCommit: (serial: number) => void }) {
  const field = useDraftCommit(
    serial,
    serialToISO,
    (iso) => { if (!iso) return 0; const n = isoToSerial(iso); return n > 0 ? n : INVALID_DRAFT; },
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
  const commit = (key: "start" | "end") => (serial: number) => {
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
