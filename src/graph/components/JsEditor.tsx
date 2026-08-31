import { useMemo, useRef, type KeyboardEvent, type RefObject } from "react";
import { highlightJs } from "../jsSyntax";
import "./FormulaEditor.css";
import "./JsEditor.css";

const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();

/** The Script source editor: a transparent <textarea> layered exactly over a
 *  highlighted <pre> (the FormulaEditor overlay technique, with lezer's JS grammar
 *  doing the coloring). Pure presentational — drafting/commit is the caller's. */
export function JsEditor({
  value, onChange, onBlur, onKeyDown, placeholder, autoFocus, taRef,
}: {
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  /** Runs after the editor's own Tab handling. */
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** The host's ref onto the textarea (focus, resize). */
  taRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const ta = taRef ?? ownRef;
  const preRef = useRef<HTMLPreElement>(null);

  // A trailing newline needs a filler char or the <pre> runs one line short of the
  // <textarea>, knocking the overlay out of alignment.
  const html = useMemo(
    () => highlightJs(value) + (value.endsWith("\n") ? " " : ""),
    [value],
  );

  function syncScroll() {
    if (preRef.current && ta.current) {
      preRef.current.scrollTop = ta.current.scrollTop;
      preRef.current.scrollLeft = ta.current.scrollLeft;
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Tab") {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: s, selectionEnd: t } = el;
      onChange(`${value.slice(0, s)}  ${value.slice(t)}`);
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 2; });
      return;
    }
    onKeyDown?.(e);
  }

  return (
    <div className="sol-js-editor">
      <pre ref={preRef} className="sol-js-editor__hl fx-tokens" aria-hidden dangerouslySetInnerHTML={{ __html: html }} />
      <textarea
        ref={ta}
        className="sol-js-editor__ta nowheel"
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoFocus={autoFocus}
        onChange={(e) => { onChange(e.target.value); }}
        onScroll={syncScroll}
        onBlur={onBlur}
        onKeyDown={handleKeyDown}
        onPointerDown={stop}
        onMouseDown={stop}
      />
    </div>
  );
}
