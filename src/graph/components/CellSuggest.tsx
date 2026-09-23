import { useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { createPortal } from "react-dom";
import { useHangUnder } from "./columnHeadControls";

/** What the host input's keydown asks first: true = the list took the key. */
export interface CellSuggestHandle { onKey: (e: { key: string; preventDefault: () => void }) => boolean }

const MAX_ITEMS = 50;

/** Never opens on focus alone and never constrains; the host input keeps focus throughout, so a press here must not blur it. */
export function CellSuggest({ options, draft, onPick, handle }: {
  options: string[];
  draft: string;
  onPick: (value: string) => void;
  handle: Ref<CellSuggestHandle>;
}) {
  const anchorRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  // `settled` is the draft the list last closed on, so it stays shut until the text moves; `allAt` is the draft the opener was pressed on, and every value shows only until the text moves.
  const [allAt, setAllAt] = useState<string | null>(null);
  const [settled, setSettled] = useState(draft);
  const [sel, setSel] = useState(-1);

  const items = useMemo(() => {
    const q = draft.trim().toLowerCase();
    const viaOpener = allAt !== null;
    if (viaOpener && (draft === allAt || q === "")) return options.slice(0, MAX_ITEMS);
    if (q === "" || (!viaOpener && draft === settled)) return [];
    // An exact match stays, first: it confirms the value exists in a column the user may not have in view.
    const exact: string[] = [], starts: string[] = [], holds: string[] = [];
    for (const o of options) {
      const t = o.toLowerCase();
      if (t === q) exact.push(o);
      else if (t.startsWith(q)) starts.push(o);
      else if (t.includes(q)) holds.push(o);
    }
    return [...exact, ...starts, ...holds].slice(0, MAX_ITEMS);
  }, [options, draft, settled, allAt]);
  const open = items.length > 0;
  const style = useHangUnder(open, anchorRef, menuRef, "left", true, items.length);

  useLayoutEffect(() => {
    if (sel >= 0) menuRef.current?.children[sel]?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  // The rows under a selection change with the text, so typing drops it.
  useLayoutEffect(() => { setSel(-1); }, [draft]);

  const close = (at: string) => { setAllAt(null); setSettled(at); setSel(-1); };
  const pick = (v: string) => { onPick(v); close(v); };

  useImperativeHandle(handle, () => ({
    onKey: (e) => {
      if (!open) return false;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const n = items.length;
        setSel((s) => (e.key === "ArrowDown" ? (s + 1) % n : (s - 1 + n) % n));
        return true;
      }
      if ((e.key === "Enter" || e.key === "Tab") && sel >= 0) { e.preventDefault(); pick(items[sel]); return true; }
      return false;
    },
  }));

  const keepFocus = (e: { preventDefault: () => void }) => e.preventDefault();
  return (
    <span
      className="table-popup__affix"
      onMouseDown={keepFocus}
      // The list hangs under the whole cell (or Form box), not under this small button.
      ref={(el) => { anchorRef.current = el?.closest<HTMLElement>("td, .table-popup__form-box") ?? null; }}
    >
      <button
        type="button"
        className="table-popup__affix-btn"
        title="Existing values"
        aria-label="Show this column's existing values"
        aria-expanded={open}
        tabIndex={-1}
        onClick={() => { if (open) close(draft); else { setAllAt(draft); setSel(-1); } }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" aria-hidden="true">
          <path d="M5.5 3.5h6.5M5.5 7h6.5M5.5 10.5h6.5" />
          <path d="M2.5 3.5h.01M2.5 7h.01M2.5 10.5h.01" strokeWidth="1.8" />
        </svg>
      </button>
      {open && createPortal(
        <ul
          ref={menuRef}
          className="table-popup__suggest nowheel"
          style={style}
          onMouseDown={keepFocus}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {items.map((v, i) => (
            <li
              key={v}
              className={`table-popup__suggest-item${i === sel ? " table-popup__suggest-item--on" : ""}`}
              onClick={() => pick(v)}
            >
              {v}
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </span>
  );
}
