import { useEffect, useState } from "react";
import type { DateRangeNode as DateRangeNodeType } from "../rete-nodes";
import { serialToJsDate, jsDateToSerial } from "../nodes/date";
import { NodeShell, type NodeProps } from "./nodeKit";
import { MeasuredSocketRow } from "./NodeSocket";
import { processGraph } from "../process";
function serialToISO(serial: number): string {
  if (!(serial > 0)) return "";
  return serialToJsDate(serial).toISOString().slice(0, 10);
}

function isoToSerial(iso: string): number {
  if (!iso) return 0;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? 0 : Math.floor(jsDateToSerial(d));
}

// Each date input sits on its own output row, so its serial leaves the matching
// socket; the picker IS the readout.
export function DateRangeComponent({ data, emit }: NodeProps<DateRangeNodeType>) {
  const [startIso, setStartIso] = useState(serialToISO(data.literals.start));
  const [endIso, setEndIso] = useState(serialToISO(data.literals.end));
  useEffect(() => { setStartIso(serialToISO(data.literals.start)); }, [data.literals.start]);
  useEffect(() => { setEndIso(serialToISO(data.literals.end)); }, [data.literals.end]);

  const commit = (key: "start" | "end", iso: string) => {
    data.literals[key] = isoToSerial(iso);
    void processGraph(data.id);
  };

  return (
    <NodeShell node={data} emit={emit} collapsible={false} hideOutputSockets>
      <MeasuredSocketRow side="output" socketKey="start" nodeId={data.id} emit={emit} payload={data.outputs.start!.socket}>
        <span className="solenoid-node__io-label">Start</span>
        <input
          type="date"
          className="solenoid-node__value-input"
          value={startIso}
          onChange={(e) => { setStartIso(e.target.value); commit("start", e.target.value); }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        />
      </MeasuredSocketRow>
      <MeasuredSocketRow side="output" socketKey="end" nodeId={data.id} emit={emit} payload={data.outputs.end!.socket}>
        <span className="solenoid-node__io-label">End</span>
        <input
          type="date"
          className="solenoid-node__value-input"
          value={endIso}
          onChange={(e) => { setEndIso(e.target.value); commit("end", e.target.value); }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        />
      </MeasuredSocketRow>
    </NodeShell>
  );
}
