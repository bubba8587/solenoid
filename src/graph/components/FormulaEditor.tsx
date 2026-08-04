import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { highlightFormula, tokenAtCaret, suggestFor, enclosingCall, type Suggestion } from "../formulaSyntax";
import { signatureFor, signatureParams } from "../formulaSignatures";
import "./FormulaEditor.css";

interface FormulaEditorProps {
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  readOnly?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  rows?: number;
  /** The node's own variable names, suggested alongside functions/constants. */
  extraNames?: string[];
  className?: string;
}

/** A formula text editor with live syntax highlighting + fuzzy autocomplete. The
 *  highlight is an overlay: a transparent <textarea> (real caret, selection, editing)
 *  layered exactly over a colored <pre> mirror. Pure presentational — no graph deps. */
export function FormulaEditor({
  value, onChange, onBlur, readOnly, placeholder, autoFocus, rows = 2, extraNames = [], className,
}: FormulaEditorProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const [menu, setMenu] = useState<{ items: Suggestion[]; sel: number; tokenStart: number } | null>(null);
  // The innermost call the caret sits in → the param-hint bar (arg-count surfacing).
  const [callHint, setCallHint] = useState<{ name: string; argIndex: number } | null>(null);
  // A caret position to restore after a controlled value change (e.g. on accept).
  const pendingCaret = useRef<number | null>(null);

  // Trailing newline needs a filler char or the <pre> is one line short of the
  // <textarea>, knocking the overlay out of alignment on the last line.
  const html = useMemo(
    () => highlightFormula(value) + (value.endsWith("\n") ? " " : ""),
    [value],
  );

  useLayoutEffect(() => {
    if (pendingCaret.current != null && taRef.current) {
      const c = pendingCaret.current;
      pendingCaret.current = null;
      taRef.current.selectionStart = taRef.current.selectionEnd = c;
    }
  });

  function syncScroll() {
    if (preRef.current && taRef.current) {
      preRef.current.scrollTop = taRef.current.scrollTop;
      preRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  }

  // Recompute the autocomplete menu from the word ending at the caret, and the
  // param-hint bar from the call the caret sits inside.
  function refreshMenu(text: string, caret: number) {
    setCallHint(enclosingCall(text, caret));
    const tok = tokenAtCaret(text, caret);
    if (!tok) { setMenu(null); return; }
    const items = suggestFor(tok.word, extraNames);
    setMenu(items.length ? { items, sel: 0, tokenStart: tok.start } : null);
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    onChange(next);
    refreshMenu(next, e.target.selectionStart);
  }

  function accept(item: Suggestion) {
    const ta = taRef.current;
    if (!ta || !menu) return;
    const caret = ta.selectionStart;
    const insert = item.name + (item.kind === "fn" ? "(" : "");
    const next = value.slice(0, menu.tokenStart) + insert + value.slice(caret);
    pendingCaret.current = menu.tokenStart + insert.length;
    setMenu(null);
    onChange(next);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!menu) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setMenu({ ...menu, sel: (menu.sel + 1) % menu.items.length }); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setMenu({ ...menu, sel: (menu.sel - 1 + menu.items.length) % menu.items.length }); }
    else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); accept(menu.items[menu.sel]); }
    else if (e.key === "Escape") { setMenu(null); /* popup's own Esc still closes it */ }
  }

  return (
    <div className={`fx-editor${className ? " " + className : ""}`}>
      <pre ref={preRef} className="fx-editor__hl fx-tokens" aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />
      <textarea
        ref={taRef}
        className="fx-editor__ta"
        value={value}
        readOnly={readOnly}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        rows={rows}
        autoFocus={autoFocus}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onKeyUp={(e) => {
          // Arrow keys / Home / End move the caret without an input event — keep
          // the param-hint bar tracking the caret (the menu keys are handled in
          // keydown and don't move the caret).
          const k = e.key;
          if (k.startsWith("Arrow") || k === "Home" || k === "End") {
            setCallHint(enclosingCall(value, (e.target as HTMLTextAreaElement).selectionStart));
          }
        }}
        onScroll={syncScroll}
        onClick={(e) => refreshMenu(value, (e.target as HTMLTextAreaElement).selectionStart)}
        onBlur={() => { setMenu(null); setCallHint(null); onBlur?.(); }}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      />
      {menu && !readOnly && (
        <ul className="fx-editor__menu">
          {menu.items.map((it, i) => (
            <li
              key={it.kind + it.name}
              className={`fx-editor__item${i === menu.sel ? " fx-editor__item--on" : ""}`}
              // Keep the textarea focused: prevent the blur that a click would cause.
              onMouseDown={(e) => { e.preventDefault(); accept(it); }}
            >
              <span className={`fx-editor__kind fx-editor__kind--${it.kind}`} aria-hidden="true">
                {it.kind === "fn" ? "ƒ" : it.kind === "const" ? "π" : "x"}
              </span>
              <span className="fx-editor__name">{it.name}</span>
              {it.hint != null && <span className="fx-editor__sig-hint">({it.hint})</span>}
            </li>
          ))}
        </ul>
      )}
      {!menu && !readOnly && callHint && <ParamHintBar name={callHint.name} argIndex={callHint.argIndex} />}
    </div>
  );
}

/** The param-hint bar: the enclosing call's signature with the caret's argument
 *  emphasized — `INDEX(array, ❰row❱, [col])`. Hidden for names with no known
 *  signature; a bare-count fallback ("2 args") shows as `NAME — 2 args`. */
function ParamHintBar({ name, argIndex }: { name: string; argIndex: number }) {
  const sig = signatureFor(name);
  if (sig == null) return null;
  const params = signatureParams(sig);
  if (params === null) {
    return <div className="fx-editor__sigbar"><b>{name.toUpperCase()}</b>&nbsp;— {sig}</div>;
  }
  if (params.length === 0) {
    return <div className="fx-editor__sigbar"><b>{name.toUpperCase()}</b>()</div>;
  }
  // Past the named params the highlight clamps to the last one (a variadic "…"
  // tail legitimately absorbs the extras; a wrong-arity call still shows where
  // the signature ended).
  const last = params.length - 1;
  const active = Math.min(argIndex, last);
  return (
    <div className="fx-editor__sigbar">
      <b>{name.toUpperCase()}</b>(
      {params.map((p, i) => (
        <span key={i} className={i === active ? "fx-editor__sigarg--on" : undefined}>
          {p}{i < last ? ", " : ""}
        </span>
      ))}
      )
    </div>
  );
}
