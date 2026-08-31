import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { highlightFormula } from "../formulaSyntax";
import "./ExpressionNode.css";
import { stopDragStart } from "../coarse";

interface FormulaFieldProps {
  /** Current formula text. */
  value: string;
  /** Called on every edit (may be async). */
  onChange: (next: string) => void;
  placeholder?: string;
  /** Wired/overridden: the local text renders dimmed and is not editable. */
  disabled?: boolean;
  disabledTitle?: string;
  /** Pack preset: read-only, but at full strength with a lock mark — it IS the
   *  intended content, not an override. */
  locked?: boolean;
  /** When set, the box never edits in place — clicking it calls onOpen. */
  onOpen?: () => void;
  /** Optional element seated in the field's corner (e.g. a resize grip). */
  grip?: ReactNode;
  /** Hide the leading "=" glyph — the Equation node's text contains its own =. */
  noPrefix?: boolean;
}

const LOCK_TITLE = "Formula set by its pack and locked. Rename the title freely.";

export function FormulaField({
  value, onChange, placeholder = "a * b + c …", disabled, disabledTitle, locked, onOpen, grip, noPrefix,
}: FormulaFieldProps) {
  const editable = !disabled && !locked && !onOpen;
  const [editing, setEditing] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const renderRef = useRef<HTMLDivElement>(null);

  // The in-node preview is SYNTAX-HIGHLIGHTED text, not typeset math: it matches
  // Excel's formula bar (and the edit textarea), stays width-stable in a small card,
  // and makes the idle→edit swap seamless. The typeset KaTeX view lives in the popup.
  const highlightHtml = useMemo(() => (value.trim() ? highlightFormula(value) : null), [value]);

  // Auto-grow the textarea to its content, capped at ~3 lines.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 72)}px`;
  }, [value, editing]);

  useEffect(() => {
    if (editing) taRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!editable && editing) setEditing(false);
  }, [editable, editing]);

  return (
    <div
      className="solenoid-expr__formula"
      style={disabled ? { opacity: 0.45 } : undefined}
      title={disabled ? disabledTitle : undefined}
    >
      {!noPrefix && <span className="solenoid-expr__prefix">=</span>}
      {/* The positioned box the grip sits in, so it lands in the FIELD's corner. */}
      <div className="solenoid-expr__field">
        {editing && editable ? (
          <textarea
            ref={taRef}
            className="solenoid-expr__textarea"
            value={value}
            placeholder={placeholder}
            rows={1}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => setEditing(false)}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            spellCheck={false}
          />
        ) : (
          <div
            ref={renderRef}
            className="solenoid-expr__rendered nowheel"
            title={onOpen ? (locked ? `${LOCK_TITLE} View.` : "Open the formula.") : locked ? LOCK_TITLE : disabled ? disabledTitle : "Edit."}
            onPointerDown={stopDragStart}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={onOpen ? () => onOpen() : editable ? () => setEditing(true) : undefined}
            style={onOpen ? { cursor: "pointer" } : locked ? { cursor: "default" } : undefined}
          >
            {highlightHtml != null ? (
              <span className="fx-tokens solenoid-expr__raw" dangerouslySetInnerHTML={{ __html: highlightHtml }} />
            ) : (
              <span className="solenoid-expr__placeholder">{placeholder}</span>
            )}
          </div>
        )}
        {onOpen && (
          <button
            type="button"
            className="solenoid-expr__expand"
            title="Open the formula"
            onPointerDown={stopDragStart}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onOpen(); }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.2" aria-hidden="true">
              <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
            </svg>
          </button>
        )}
        {grip}
      </div>
    </div>
  );
}
