import type { DateInputNode as DateInputNodeType } from "../rete-nodes";
import { parseDateToSerial, formatDateSerial, DEFAULT_DATE_FORMAT } from "../nodes/date";
import { NodeShell, type NodeProps } from "./nodeKit";
import { useDraftCommit, INVALID_DRAFT } from "./inlineInput";
import { processGraph } from "../process";

// A typed date field: the value is an Excel serial, shown in the app's DD-MMM-YYYY
// convention. Typing commits on Enter/blur (Escape reverts) like every other cell;
// any date JS can read is accepted and normalized back to DD-MMM-YYYY.
export function DateInputComponent({ data, emit }: NodeProps<DateInputNodeType>) {
  const { draft, setDraft, onBlur, onKeyDown } = useDraftCommit<number>(
    data.value,
    (v) => (v > 0 ? formatDateSerial(v, DEFAULT_DATE_FORMAT) : ""),
    (text) => {
      const t = text.trim();
      if (t === "") return 0; // cleared → unset
      const serial = parseDateToSerial(t);
      return Number.isFinite(serial) ? Math.floor(serial) : INVALID_DRAFT;
    },
    (v) => { data.value = v; void processGraph(data.id); },
  );

  return (
    <NodeShell node={data} emit={emit} labelPlaceholder="Date" collapsible={false}>
      <input
        type="text"
        inputMode="text"
        className="solenoid-node__value-input"
        value={draft}
        placeholder={DEFAULT_DATE_FORMAT}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      />
    </NodeShell>
  );
}
