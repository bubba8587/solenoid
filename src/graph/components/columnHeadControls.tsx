import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { stepListSel } from "./gridKeyboard";
import { tokenAtCaret } from "../formulaSyntax";
import { useDismissOnOutside } from "./useDismissOnOutside";
import { PaintbrushIcon } from "./PaintbrushIcon";
import { InfoIcon } from "./Icons";
import { TypeIcon } from "./TypeIcon";
import { closeParens } from "../closeParens";

type ColType = "number" | "string" | "date" | "logical";
export const COLTYPE_ORDER: ColType[] = ["number", "string", "date", "logical"];
export const COLTYPE_NAME: Record<ColType, string> = { number: "Number", string: "Text", date: "Date", logical: "Boolean" };


/** Hidden until first placed; carries the popup's accent, which a portal would otherwise lose. */
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

/** `picked`: this node made a pick for the column, so the button earns the accent. */
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

/** The header legend: what a column's type button cycles, and the names an Fx formula reads ([[C22]] rowFormulaRefs). */
const FX_LEGEND: [string, string][] = [
  ["@price", "this row's price"],
  ["price", "the whole price column"],
  ["@[Unit Price]", "a name with spaces"],
  ["ROW()", "this row's number"],
  ["ROWS(price)", "the row count"],
  ["@price / SUM(price)", "this row's share of the total"],
];

/** `cube`: the Cube popup's legend, which adds the None type and a list column's `@` read ([[C22]] rowFormulaRefs). */
export function HeaderHelpButton({ formulas, lambdas, cube = false }: { formulas: boolean; lambdas: boolean; cube?: boolean }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside(open, () => setOpen(false), [btnRef, panelRef]);
  const style = useHangUnder(open, btnRef, panelRef, "left");

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        className="table-popup__helpbtn"
        title="Column headers"
        aria-label="Column headers"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
      >
        <InfoIcon size={14} />
      </button>
      {open && createPortal(
        <div ref={panelRef} className="table-popup__helppanel" style={style} {...stopAll}>
          <div className="table-popup__helphead">Column Type</div>
          <dl className="table-popup__helplist">
            {cube && <div><dt>–</dt><dd>None, any kind per cell</dd></div>}
            {COLTYPE_ORDER.map((t) => <div key={t}><dt><TypeIcon type={t} size={12} /></dt><dd>{COLTYPE_NAME[t]}</dd></div>)}
            {formulas && <div><dt>Fx</dt><dd>a formula, run once per row</dd></div>}
          </dl>
          {formulas && (
            <>
              <div className="table-popup__helphead">In an Fx Formula</div>
              <dl className="table-popup__helplist">
                {FX_LEGEND.map(([code, meaning]) => (
                  <div key={code}><dt>{code}</dt><dd>{meaning}</dd></div>
                ))}
                {cube && <div><dt>COUNTA(@tags)</dt><dd>how many tags this row's list holds</dd></div>}
                {lambdas && <div><dt>λ1</dt><dd>runs that LAMBDA, each parameter reading the column of its name</dd></div>}
              </dl>
            </>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

/** The draft is the parent's (`value`, `onDraft`). */
export function ColumnExprField({ value, lambdaOptions, onDraft, onCommit, onRevert }: {
  value: string;
  lambdaOptions: string[];
  onDraft: (next: string) => void;
  onCommit: (text: string) => void;
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
          const text = closeParens(value);
          if (text !== value) onDraft(text);
          onCommit(text);
        }}
        onKeyDown={(e) => {
          if (open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            const n = lambdaOptions.length;
            setSel((s) => stepListSel(s, n, e.key === "ArrowDown" ? 1 : -1));
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
