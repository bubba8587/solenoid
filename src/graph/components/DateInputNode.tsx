import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { DateInputNode as DateInputNodeType } from "../rete-nodes";
import { jsDateToSerial, parseDate, isRelativeDateText, formatDateSerial, DEFAULT_DATE_FORMAT } from "../nodes/date";
import { isSolError } from "../errorValue";
import { settingsStore } from "../settingsStore";
import { NodeShell, type NodeProps } from "./nodeKit";
import { useDismissOnOutside } from "./useDismissOnOutside";
import { processGraph } from "../process";

/** Examples for the (i) popup — valid inputs across the relative + absolute forms. No prose. */
const FORMAT_EXAMPLES = ["today", "tomorrow", "yesterday", "next friday", "last monday", "in 3 days", "2 weeks ago", "15-Mar-2026", "2026-03-15"];
const isoOf = (serial: number) => new Date((serial - 25569) * 86400000).toISOString().slice(0, 10);

// The raw source text is the truth (the Frame/Table date model). We render the app's
// DD-MMM-YYYY convention when idle but show exactly what was typed while editing, and never
// discard an entry: an ambiguous date (3/4/2026) or unparseable text stays put and flags red.
// Parsing is the shared parseDate (chrono-backed, #AMBIGUOUS-aware). The calendar button opens
// the browser's native picker; its ISO value flows in underneath.
export function DateInputComponent({ data, emit }: NodeProps<DateInputNodeType>) {
  const nativeRef = useRef<HTMLInputElement>(null);
  // Mirror the node: a relative phrase is valid ONLY under the Relative dates opt-in.
  const relativeAllowed = useSyncExternalStore(settingsStore.subscribe, () => settingsStore.get("relativeDates"));
  const raw = data.stringLiterals.date ?? "";
  const t = raw.trim();
  const relative = relativeAllowed && isRelativeDateText(t);
  const parsed = parseDate(t, relative ? { relative: true } : undefined);
  const serial = typeof parsed === "number" && Number.isFinite(parsed) ? Math.floor(parsed) : null;
  const bad = isSolError(parsed) || (t !== "" && serial === null);
  // A relative phrase keeps its own text (it re-resolves each pass); an absolute date shows DD-MMM-YYYY.
  const idleText = serial !== null && !relative ? formatDateSerial(serial, DEFAULT_DATE_FORMAT) : raw;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(raw);
  const [infoOpen, setInfoOpen] = useState(false);
  const infoBtnRef = useRef<HTMLButtonElement>(null);
  const infoPopRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside(infoOpen, () => setInfoOpen(false), [infoBtnRef, infoPopRef]);
  // Resync the draft to the source when it changes underneath us (undo, native pick, load).
  useEffect(() => { if (!editing) setDraft(raw); }, [raw, editing]);

  const commit = (text: string) => { data.stringLiterals.date = text; void processGraph(data.id); };
  const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();

  return (
    <NodeShell node={data} emit={emit} collapsible={false}>
      <div className="solenoid-date-input" style={{ position: "relative", display: "flex", alignItems: "center", gap: 4 }}>
        <input
          type="text"
          className="solenoid-node__value-input"
          value={editing ? draft : idleText}
          placeholder={DEFAULT_DATE_FORMAT}
          spellCheck={false}
          title={isSolError(parsed) ? parsed.message : undefined}
          style={{ flex: 1, minWidth: 0, color: bad ? "var(--error, #c0392b)" : undefined }}
          onFocus={() => { setDraft(raw); setEditing(true); }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { commit(draft); setEditing(false); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
            else if (e.key === "Escape") { setDraft(raw); setEditing(false); e.currentTarget.blur(); }
          }}
          onPointerDown={stop}
          onMouseDown={stop}
        />
        {relativeAllowed && (
          <button
            ref={infoBtnRef}
            type="button"
            className="solenoid-date-input__picker"
            title="Supported formats"
            aria-label="Supported date formats"
            onPointerDown={stop}
            onMouseDown={stop}
            onClick={() => setInfoOpen((o) => !o)}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 2, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer" }}
          >
            {/* Lucide "info" (ISC). */}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
            </svg>
          </button>
        )}
        {infoOpen && (
          <div
            ref={infoPopRef}
            className="nowheel"
            onPointerDown={stop}
            onMouseDown={stop}
            style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 20, minWidth: 128, padding: "6px 9px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, boxShadow: "0 4px 14px rgba(0,0,0,0.32)" }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-bright)", marginBottom: 5 }}>Supported Formats</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {FORMAT_EXAMPLES.map((ex) => (
                <span key={ex} style={{ fontSize: 11, fontFamily: "var(--font-mono, monospace)", color: "var(--text)" }}>{ex}</span>
              ))}
            </div>
          </div>
        )}
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
        <input
          ref={nativeRef}
          type="date"
          value={serial !== null ? isoOf(serial) : ""}
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const v = e.target.value; // native picker → an unambiguous ISO date
            if (!v) { commit(""); return; }
            const d = new Date(`${v}T00:00:00Z`);
            commit(Number.isNaN(d.getTime()) ? "" : formatDateSerial(Math.floor(jsDateToSerial(d)), DEFAULT_DATE_FORMAT));
          }}
          onPointerDown={stop}
          onMouseDown={stop}
          style={{ position: "absolute", right: 2, bottom: 0, width: 1, height: 1, opacity: 0, pointerEvents: "none", border: "none", padding: 0 }}
        />
      </div>
    </NodeShell>
  );
}
