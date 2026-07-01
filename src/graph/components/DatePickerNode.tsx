import { useEffect, useState } from "react";
import type { DatePickerNode as DatePickerNodeType } from "../rete-nodes";
import { serialToJsDate, jsDateToSerial } from "../nodes/date";
import { NodeShell, type NodeProps } from "./nodeKit";
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

export function DatePickerComponent({ data, emit }: NodeProps<DatePickerNodeType>) {
  const [iso, setIso] = useState(serialToISO(data.value));

  // Keep the field in sync if the serial changes from elsewhere (load/paste).
  useEffect(() => { setIso(serialToISO(data.value)); }, [data.value]);

  return (
    <NodeShell node={data} emit={emit} labelPlaceholder="Date" collapsible={false}>
      <input
        type="date"
        className="solenoid-node__value-input"
        value={iso}
        onChange={(e) => {
          setIso(e.target.value);
          data.value = isoToSerial(e.target.value);
          void processGraph(data.id);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      />
    </NodeShell>
  );
}
