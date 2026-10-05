import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  extraNames?: string[];
  className?: string;
}

/** The caret's offset in the formula's text: a ghost is CSS content, so it never counts. */
function caretOffset(root: HTMLElement): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !root.contains(sel.anchorNode)) return null;
  const r = sel.getRangeAt(0);
  const at = (node: Node, offset: number) => {
    const pre = document.createRange();
    pre.setStart(root, 0);
    pre.setEnd(node, offset);
    return pre.toString().length;
  };
  return { start: at(r.startContainer, r.startOffset), end: at(r.endContainer, r.endOffset) };
}

/** Puts the caret at a text offset, at the end of the text node it falls in, so it sits before a ghost, never after. */
function placeCaret(root: HTMLElement, offset: number) {
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let left = offset;
  let node: Node | null = null;
  let at = 0;
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const len = n.textContent!.length;
    node = n;
    at = Math.min(left, len);
    if (left <= len) break;
    left -= len;
  }
  const range = document.createRange();
  if (node) range.setStart(node, at);
  else range.setStart(root, 0);
  range.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

// A trailing newline needs a <br> to open its line; the <br> adds no text.
const render = (text: string) => highlightFormula(text, "editor") + (text.endsWith("\n") ? "<br>" : "");

interface Snapshot { text: string; caret: number; at: number }

/**
 * An editable box that draws its own highlighted text, so an empty slot's reading takes real width beside the
 * typed text ([[D96]] emptySlotShowsItsValue). Each edit reads the text back, redraws it and puts the caret back;
 * redrawing drops the browser's undo, so the editor keeps its own. No graph deps.
 */
export function FormulaEditor({
  value, onChange, onBlur, readOnly, placeholder, autoFocus, rows = 2, extraNames = [], className,
}: FormulaEditorProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ items: Suggestion[]; sel: number; tokenStart: number } | null>(null);
  const [callHint, setCallHint] = useState<{ name: string; argIndex: number } | null>(null);
  const drawn = useRef<string | null>(null);
  const composing = useRef(false);
  const history = useRef<{ stack: Snapshot[]; at: number }>({ stack: [{ text: value, caret: value.length, at: 0 }], at: 0 });

  function draw(text: string, caret: number | null) {
    const box = boxRef.current;
    if (!box) return;
    const html = render(text);
    if (box.innerHTML !== html) box.innerHTML = html;
    drawn.current = text;
    if (caret !== null) placeCaret(box, caret);
  }

  // A value from outside (an accepted suggestion, a reset) redraws, keeping the caret where it was.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || composing.current || drawn.current === value) return;
    const focused = document.activeElement === box;
    const caret = focused ? caretOffset(box)?.start ?? value.length : null;
    draw(value, caret === null ? null : Math.min(caret, value.length));
    // Before any edit, a value from outside is where undo stops.
    const h = history.current;
    const snap = { text: value, caret: value.length, at: 0 };
    if (h.stack.length === 1) h.stack[0] = snap;
    else { h.stack = [...h.stack.slice(0, h.at + 1), snap]; h.at = h.stack.length - 1; }
  });

  useEffect(() => {
    const box = boxRef.current;
    if (!autoFocus || !box) return;
    box.focus();
    placeCaret(box, drawn.current?.length ?? 0);
  }, [autoFocus]);

  function refreshMenu(text: string, caret: number) {
    setCallHint(enclosingCall(text, caret));
    const tok = tokenAtCaret(text, caret);
    if (!tok) { setMenu(null); return; }
    const items = suggestFor(tok.word, extraNames);
    setMenu(items.length ? { items, sel: 0, tokenStart: tok.start } : null);
  }

  function record(text: string, caret: number) {
    const h = history.current;
    const now = Date.now();
    h.stack = h.stack.slice(0, h.at + 1);
    const top = h.stack[h.at];
    // Typing in one burst is one undo step.
    if (h.at > 0 && now - top.at < 600) h.stack[h.at] = { text, caret, at: now };
    else { h.stack.push({ text, caret, at: now }); h.at = h.stack.length - 1; }
  }

  /** The one way the text changes: redraw, put the caret back, remember it for undo, report it. */
  function commit(text: string, caret: number, remember = true) {
    draw(text, caret);
    if (remember) record(text, caret);
    onChange(text);
    refreshMenu(text, caret);
  }

  function replaceSelection(insert: string) {
    const box = boxRef.current;
    if (!box) return;
    const text = drawn.current ?? value;
    const sel = caretOffset(box) ?? { start: text.length, end: text.length };
    commit(text.slice(0, sel.start) + insert + text.slice(sel.end), sel.start + insert.length);
  }

  function handleInput() {
    const box = boxRef.current;
    if (!box || composing.current) return;
    const text = box.textContent ?? "";
    commit(text, caretOffset(box)?.start ?? text.length);
  }

  function stepHistory(by: number) {
    const h = history.current;
    const next = h.at + by;
    if (next < 0 || next >= h.stack.length) return;
    h.at = next;
    h.stack[next] = { ...h.stack[next], at: 0 };
    commit(h.stack[next].text, h.stack[next].caret, false);
  }

  function accept(item: Suggestion) {
    const box = boxRef.current;
    if (!box || !menu) return;
    const text = drawn.current ?? value;
    const caret = caretOffset(box)?.start ?? text.length;
    const insert = item.name + (item.kind === "fn" ? "(" : "");
    setMenu(null);
    commit(text.slice(0, menu.tokenStart) + insert + text.slice(caret), menu.tokenStart + insert.length);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && (e.key === "z" || e.key === "Z" || e.key === "y")) {
      e.preventDefault();
      stepHistory(e.key === "y" || e.shiftKey ? 1 : -1);
      return;
    }
    if (menu) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMenu({ ...menu, sel: (menu.sel + 1) % menu.items.length }); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setMenu({ ...menu, sel: (menu.sel - 1 + menu.items.length) % menu.items.length }); }
      else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); accept(menu.items[menu.sel]); }
      else if (e.key === "Escape") { setMenu(null); /* popup's own Esc still closes it */ }
      return;
    }
    // The browser's own line break is a <div> or a <br>; the text's is a newline.
    if (e.key === "Enter") { e.preventDefault(); replaceSelection("\n"); }
  }

  function refreshAtCaret() {
    const box = boxRef.current;
    const caret = box && caretOffset(box);
    if (caret) refreshMenu(drawn.current ?? value, caret.start);
  }

  return (
    <div className={`fx-editor${className ? " " + className : ""}`}>
      <div
        ref={boxRef}
        className="fx-editor__input fx-tokens nowheel"
        contentEditable={!readOnly}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-readonly={readOnly || undefined}
        data-placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        style={{ minHeight: `calc(${rows} * 1.5em + 14px)` }}
        onInput={handleInput}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; handleInput(); }}
        onPaste={(e) => { e.preventDefault(); replaceSelection(e.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n")); }}
        onDrop={(e) => e.preventDefault()}
        onKeyDown={handleKeyDown}
        onKeyUp={(e) => {
          // Arrow keys, Home and End move the caret without an input event, so the hint bar and the menu's token refresh here.
          const k = e.key;
          if (k === "ArrowLeft" || k === "ArrowRight" || k === "Home" || k === "End") refreshAtCaret();
          else if ((k === "ArrowUp" || k === "ArrowDown") && !menu) {
            const box = boxRef.current;
            const caret = box && caretOffset(box);
            if (caret) setCallHint(enclosingCall(drawn.current ?? value, caret.start));
          }
        }}
        onClick={refreshAtCaret}
        onBlur={() => { setMenu(null); setCallHint(null); onBlur?.(); }}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      />
      {menu && !readOnly && (
        <ul className="fx-editor__menu nowheel">
          {menu.items.map((it, i) => (
            <li
              key={it.kind + it.name}
              className={`fx-editor__item${i === menu.sel ? " fx-editor__item--on" : ""}`}
              // Keep the editor focused: prevent the blur that a click would cause.
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

/** Hidden for a name with no known signature. */
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
  // Past the named params the highlight clamps to the last: a variadic tail absorbs extras, and a wrong-arity call still shows where the signature ended.
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
