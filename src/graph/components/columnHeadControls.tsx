import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { tokenAtCaret } from "../formulaSyntax";
import { useDismissOnOutside } from "./useDismissOnOutside";
import { PaintbrushIcon } from "./PaintbrushIcon";

// Both floating panels PORTAL to <body> and sit `position: fixed` under their anchor,
// above the popup layer: the header lives in the grid's scroll container, which would
// clip (and be reflowed by) anything rendered in place.

/** Hang `panel` under `anchor` while open, clamped into the viewport, re-placed on any
 *  scroll or resize. Returns the style the panel carries: hidden until first placed,
 *  plus the popup's accent, which a portal would otherwise lose. */
export function useHangUnder(
  open: boolean,
  anchor: RefObject<HTMLElement | null>,
  panel: RefObject<HTMLElement | null>,
  align: "left" | "right",
  /** The panel is at least as wide as its anchor (a list under the cell it fills). */
  matchWidth = false,
  /** Re-place when this changes: a panel whose content (so its height) moves while open. */
  rev: unknown = 0,
): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });
  useLayoutEffect(() => {
    if (!open) { setStyle({ visibility: "hidden" }); return; }
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const p = panel.current?.getBoundingClientRect();
      if (!a || !p) return;
      const pad = 8;
      const wanted = align === "left" ? a.left : a.right - p.width;
      const left = Math.min(Math.max(wanted, pad), window.innerWidth - p.width - pad);
      // Flip above the anchor when there is no room below.
      const below = a.bottom + 3;
      const top = below + p.height + pad > window.innerHeight ? Math.max(pad, a.top - 3 - p.height) : below;
      const accent = getComputedStyle(anchor.current!).getPropertyValue("--node-accent").trim();
      setStyle({
        left: Math.round(left), top: Math.round(top),
        ...(matchWidth ? { minWidth: Math.round(a.width) } : {}),
        ...(accent ? { ["--node-accent" as string]: accent } : {}),
      });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, align, anchor, panel, matchWidth, rev]);
  return style;
}

// A portal's React events still bubble to the popup card; the panel is its own surface.
const stopAll = {
  onClick: (e: { stopPropagation: () => void }) => e.stopPropagation(),
  onPointerDown: (e: { stopPropagation: () => void }) => e.stopPropagation(),
};

/** Paintbrush + chevron: the column's Format Controller picks, in a dropdown panel.
 *  `picked` = this node made a pick for the column (state, so it earns the accent). */
export function ColumnFormatButton({ picked, children }: { picked: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside(open, () => setOpen(false), [btnRef, panelRef]);
  const style = useHangUnder(open, btnRef, panelRef, "right");

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        className={`table-popup__fmtbtn${picked ? " table-popup__fmtbtn--picked" : ""}`}
        title="Column format"
        aria-label="Column format"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
      >
        <PaintbrushIcon size={12} />
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor"
             strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="1.5,3 4,5.5 6.5,3" />
        </svg>
      </button>
      {open && createPortal(
        <div ref={panelRef} className="table-popup__fmtpanel" style={style} {...stopAll}>
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}

/** A column's row-wise formula. The draft is the parent's (`value`/`onDraft`); blur or
 *  Enter commits, Escape reverts ([[C95]] commitOnEnter). While the field is focused the
 *  host's λ socket names list below it; picking one types the name at the caret. */
export function ColumnExprField({ value, lambdaOptions, onDraft, onCommit, onRevert }: {
  value: string;
  lambdaOptions: string[];
  onDraft: (next: string) => void;
  onCommit: () => void;
  onRevert: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const [focused, setFocused] = useState(false);
  const [sel, setSel] = useState(-1);
  const escaped = useRef(false);
  const pendingCaret = useRef<number | null>(null);
  const open = focused && lambdaOptions.length > 0;
  const style = useHangUnder(open, inputRef, menuRef, "left");

  useLayoutEffect(() => {
    if (pendingCaret.current != null && inputRef.current) {
      const c = pendingCaret.current;
      pendingCaret.current = null;
      inputRef.current.selectionStart = inputRef.current.selectionEnd = c;
    }
  });

  function accept(name: string) {
    const el = inputRef.current;
    if (!el) return;
    const caret = el.selectionStart ?? value.length;
    // A half-typed name at the caret is replaced; anything else is left alone.
    const tok = tokenAtCaret(value, caret);
    const start = tok && name.toLowerCase().startsWith(tok.word.toLowerCase()) ? tok.start : caret;
    pendingCaret.current = start + name.length;
    setSel(-1);
    onDraft(value.slice(0, start) + name + value.slice(caret));
  }

  return (
    <div className="table-popup__exprrow">
      <span className="table-popup__exprprefix">=</span>
      <input
        ref={inputRef}
        className="table-popup__input table-popup__input--text table-popup__exprinput"
        value={value}
        placeholder="@price * @qty"
        spellCheck={false}
        onChange={(e) => onDraft(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setSel(-1);
          if (escaped.current) { escaped.current = false; return; }
          onCommit();
        }}
        onKeyDown={(e) => {
          if (open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            const n = lambdaOptions.length;
            setSel((s) => (e.key === "ArrowDown" ? (s + 1) % n : (s - 1 + n) % n));
          } else if (open && sel >= 0 && (e.key === "Enter" || e.key === "Tab")) {
            e.preventDefault();
            accept(lambdaOptions[sel]);
          } else if (e.key === "Enter") {
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            // The flag stops the following blur from committing the reverted text.
            escaped.current = true;
            onRevert();
            e.currentTarget.blur();
          }
        }}
      />
      {open && createPortal(
        <ul ref={menuRef} className="table-popup__lammenu" style={style} {...stopAll}>
          {lambdaOptions.map((name, i) => (
            <li
              key={name}
              className={`table-popup__lamitem${i === sel ? " table-popup__lamitem--on" : ""}`}
              // Keep the field focused: prevent the blur a click would cause.
              onMouseDown={(e) => { e.preventDefault(); accept(name); }}
            >
              {name}
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </div>
  );
}
