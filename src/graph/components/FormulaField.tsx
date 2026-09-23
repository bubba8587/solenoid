// [[C76]] formulaPackDefault (`locked`)
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { highlightFormula } from "../formulaSyntax";
import "./ExpressionNode.css";
import { stopDragStart } from "../coarse";

interface FormulaFieldProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
  disabledTitle?: string;
  /** Pack preset: read-only but at full strength with a lock mark, since it is the intended content, not an override. */
  locked?: boolean;
  onOpen?: () => void;
  grip?: ReactNode;
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

  // Syntax-highlighted, not typeset: it matches the formula bar and the edit textarea, stays width-stable, and makes the idle-to-edit swap seamless.
  const highlightHtml = useMemo(() => (value.trim() ? highlightFormula(value) : null), [value]);

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
      {/* The positioned box, so the grip lands in the field's corner. */}
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
