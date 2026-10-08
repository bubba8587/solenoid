// [[C76]] formulaPackDefault (`locked`)
import { useMemo } from "react";
import { highlightFormula } from "../formulaSyntax";
import "./ExpressionNode.css";
import { stopDragStart } from "../coarse";

interface FormulaFieldProps {
  value: string;
  placeholder?: string;
  /** Pack preset: read-only but at full strength with a lock mark, since it is the intended content, not an override. */
  locked?: boolean;
  /** Every edit happens in the formula popup. */
  onOpen: () => void;
  noPrefix?: boolean;
}

const LOCK_TITLE = "Formula set by its pack and locked. Rename the title freely.";

export function FormulaField({ value, placeholder = "a * b + c …", locked, onOpen, noPrefix }: FormulaFieldProps) {
  // Syntax-highlighted, not typeset: it matches the formula bar and the popup's editor, and stays width-stable.
  const highlightHtml = useMemo(() => (value.trim() ? highlightFormula(value) : null), [value]);

  return (
    <div className="solenoid-expr__formula">
      {!noPrefix && <span className="solenoid-expr__prefix">=</span>}
      <div className="solenoid-expr__field">
        <div
          className="solenoid-expr__rendered nowheel"
          title={locked ? `${LOCK_TITLE} View.` : "Open the formula."}
          onPointerDown={stopDragStart}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => onOpen()}
          style={{ cursor: "pointer" }}
        >
          {highlightHtml != null ? (
            <span className="fx-tokens solenoid-expr__raw" dangerouslySetInnerHTML={{ __html: highlightHtml }} />
          ) : (
            <span className="solenoid-expr__placeholder">{placeholder}</span>
          )}
        </div>
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
      </div>
    </div>
  );
}
