import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useKatexRender } from "./katexLoader";
import { formulaToLatex } from "../excelFormula";
import { useFormulaFit } from "./formulaFit";
import "./ExpressionNode.css";
import { stopDragStart } from "../coarse";

interface FormulaFieldProps {
  /** Current formula text. */
  value: string;
  /** Called on every edit (may be async). */
  onChange: (next: string) => void;
  placeholder?: string;
  /** Wired/overridden (e.g. a Text Input feeds the formula socket): the box
   *  renders the local text dimmed and is not editable. */
  disabled?: boolean;
  disabledTitle?: string;
  /** Pack preset: the formula is fixed, so the box is read-only — but rendered at
   *  full strength (it's the intended content, not an override) with a lock mark. */
  locked?: boolean;
  /** When set, the box never edits in place — clicking it calls onOpen. Every
   *  current host (Expression, LAMBDA, the lambda family) routes editing to the
   *  formula popup this way; the inline-textarea path below is kept for hosts
   *  that omit onOpen. */
  onOpen?: () => void;
  /** Optional element seated in the field's corner (e.g. a resize grip). */
  grip?: ReactNode;
  /** Hide the leading "=" glyph — the Equation node's text contains its own =. */
  noPrefix?: boolean;
}

/**
 * Reusable "= [ formula ]" box. Shows the formula rendered with KaTeX (falling
 * back to raw text when it can't be parsed, or a placeholder when empty); click
 * to edit it as plain text in an auto-growing textarea. Shared by the Expression
 * node and the LAMBDA family — any node with a textual formula gets the same
 * rendered box for free, whether or not it exposes a formula input socket.
 */
const LOCK_TITLE = "Formula set by its pack and locked. Rename the title freely.";

export function FormulaField({
  value, onChange, placeholder = "a * b + c …", disabled, disabledTitle, locked, onOpen, grip, noPrefix,
}: FormulaFieldProps) {
  // Inline editing applies only to the click-to-edit (LAMBDA) case: not when
  // wired/overridden, not when locked, and not when a popup owns editing (onOpen).
  const editable = !disabled && !locked && !onOpen;
  const [editing, setEditing] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const renderRef = useRef<HTMLDivElement>(null);

  // Rendered LaTeX (KaTeX → HTML), or null when the formula is empty, can't be
  // parsed, or katex hasn't loaded yet; in that case we fall back to the raw text.
  const render = useKatexRender();
  const katexHtml = useMemo(() => {
    if (!render) return null;
    const latex = formulaToLatex(value);
    if (latex == null) return null;
    try {
      return render(latex, { throwOnError: false, displayMode: false });
    } catch {
      return null;
    }
  }, [value, render]);

  // Auto-grow the textarea to its content, capped at ~3 lines (only while editing).
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 72)}px`;
  }, [value, editing]);

  useEffect(() => {
    if (editing) taRef.current?.focus();
  }, [editing]);

  // A non-editable field (wired/overridden, or a locked pack preset) can't be
  // edited — leave edit mode if it becomes so.
  useEffect(() => {
    if (!editable && editing) setEditing(false);
  }, [editable, editing]);

  // Fit the rendered formula to the box: scale down for a long formula, up to fill
  // the (now taller) card box. Width-bound formulas still bottom out and scroll —
  // structural wrapping is the separate lever.
  useFormulaFit(renderRef, [katexHtml, value, editing, disabled], { useHeight: true, max: 1.9 });

  return (
    <div
      className="solenoid-expr__formula"
      style={disabled ? { opacity: 0.45 } : undefined}
      title={disabled ? disabledTitle : undefined}
    >
      {!noPrefix && <span className="solenoid-expr__prefix">=</span>}
      {/* The field wrapper is the positioned box the grip sits in, so the grip
          lands in the field's corner (not the outer row's padding). */}
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
            className="solenoid-expr__rendered"
            title={onOpen ? (locked ? `${LOCK_TITLE} Click to view.` : "Click to open the formula") : locked ? LOCK_TITLE : disabled ? disabledTitle : "Click to edit"}
            onPointerDown={stopDragStart}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={onOpen ? () => onOpen() : editable ? () => setEditing(true) : undefined}
            style={onOpen ? { cursor: "pointer" } : locked ? { cursor: "default" } : undefined}
          >
            {katexHtml != null ? (
              <span dangerouslySetInnerHTML={{ __html: katexHtml }} />
            ) : value.trim() ? (
              <span className="solenoid-expr__raw">{value}</span>
            ) : (
              <span className="solenoid-expr__placeholder">{placeholder}</span>
            )}
          </div>
        )}
        {/* Expand → open the formula popup. A FormulaField feature, so every node
            with a rendered formula (Expression, LAMBDA family) gets it by passing
            onOpen; the box click opens it too. */}
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
