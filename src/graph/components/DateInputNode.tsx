import { useRef } from "react";
import type { DateInputNode as DateInputNodeType } from "../rete-nodes";
import { serialToJsDate, jsDateToSerial, parseDateToSerial, formatDateSerial, DEFAULT_DATE_FORMAT } from "../nodes/date";
import { NodeShell, type NodeProps } from "./nodeKit";
import { useDraftCommit, INVALID_DRAFT } from "./inlineInput";
import { processGraph } from "../process";

const isoOf = (serial: number) => (serial > 0 ? serialToJsDate(serial).toISOString().slice(0, 10) : "");

// A date value shown in the app's DD-MMM-YYYY convention (e.g. 20-Mar-2026). Typing is
// free-form and coerced by the SAME parser the Frame/Table date columns use
// (parseDateToSerial via coerceFrameCell): the raw text is left untouched while editing and
// re-rendered in our format on commit (Enter/blur; Escape reverts). The calendar button
// opens the browser's native picker, whose ISO value flows in underneath.
export function DateInputComponent({ data, emit }: NodeProps<DateInputNodeType>) {
  const nativeRef = useRef<HTMLInputElement>(null);
  const commit = (v: number) => { data.value = v; void processGraph(data.id); };

  const { draft, setDraft, onBlur, onKeyDown } = useDraftCommit<number>(
    data.value,
    (v) => (v > 0 ? formatDateSerial(v, DEFAULT_DATE_FORMAT) : ""),
    (text) => {
      const t = text.trim();
      if (t === "") return 0; // cleared → unset
      const serial = parseDateToSerial(t);
      return Number.isFinite(serial) ? Math.floor(serial) : INVALID_DRAFT;
    },
    commit,
  );

  const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();

  return (
    <NodeShell node={data} emit={emit} labelPlaceholder="Date" collapsible={false}>
      <div className="solenoid-date-input" style={{ position: "relative", display: "flex", alignItems: "center", gap: 4 }}>
        <input
          type="text"
          className="solenoid-node__value-input"
          value={draft}
          placeholder={DEFAULT_DATE_FORMAT}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          onPointerDown={stop}
          onMouseDown={stop}
          style={{ flex: 1, minWidth: 0 }}
        />
        <button
          type="button"
          className="solenoid-date-input__picker"
          title="Pick a date"
          aria-label="Open the calendar"
          onPointerDown={stop}
          onMouseDown={stop}
          onClick={() => {
            const el = nativeRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
            if (!el) return;
            try { el.showPicker?.(); } catch { el.focus(); }
          }}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 2, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer" }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <rect x="1.5" y="2.5" width="11" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <path d="M1.5 5.5h11M4.5 1v2.5M9.5 1v2.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
        {/* The native picker: ISO underneath; positioned by the icon so its popup anchors there. */}
        <input
          ref={nativeRef}
          type="date"
          value={isoOf(data.value)}
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const v = e.target.value;
            if (!v) { commit(0); return; }
            const d = new Date(`${v}T00:00:00Z`);
            commit(Number.isNaN(d.getTime()) ? 0 : Math.floor(jsDateToSerial(d)));
          }}
          onPointerDown={stop}
          onMouseDown={stop}
          style={{ position: "absolute", right: 2, bottom: 0, width: 1, height: 1, opacity: 0, pointerEvents: "none", border: "none", padding: 0 }}
        />
      </div>
    </NodeShell>
  );
}
