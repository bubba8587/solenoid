// [[D90]] cubeTypesAtDepth
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useHangUnder } from "./columnHeadControls";
import type { CellKind } from "../literalEditors";

const KINDS: { kind: CellKind; label: string; tip?: string }[] = [
  { kind: "value", label: "Value" },
  { kind: "list", label: "List" },
  { kind: "table", label: "Table", tip: "Rows of values, with no column names" },
  { kind: "frame", label: "Frame", tip: "Named, typed columns of single values" },
  { kind: "cube", label: "Cube", tip: "Named columns whose cells can also hold lists, tables, Frames and Cubes" },
];

/** Opens from the cell's edge; a press here must not blur a focused cell, or the edit commits and re-renders under the menu. */
export function CellKindMenu({ kind, onPick }: { kind: CellKind; onPick: (kind: CellKind) => void }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const style = useHangUnder(open, anchorRef, menuRef, "right");
  const keepFocus = (e: { preventDefault: () => void }) => e.preventDefault();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = (e.composedPath()[0] ?? e.target) as Node;
      if (!menuRef.current?.contains(t) && !anchorRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <span className="table-popup__affix cube-edit__kind" onMouseDown={keepFocus} ref={(el) => { anchorRef.current = el; }}>
      <button
        type="button"
        className="table-popup__affix-btn"
        title="Value, List, Table, Frame or Cube"
        aria-label="Change what this cell holds"
        aria-haspopup="menu"
        aria-expanded={open}
        tabIndex={-1}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 3.5 5 6.5 8 3.5" />
        </svg>
      </button>
      {open && createPortal(
        <ul
          ref={menuRef}
          className="table-popup__suggest nowheel"
          role="menu"
          style={style}
          onMouseDown={keepFocus}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {KINDS.map((k) => (
            <li
              key={k.kind}
              role="menuitemradio"
              aria-checked={k.kind === kind}
              title={k.tip}
              className={`table-popup__suggest-item${k.kind === kind ? " table-popup__suggest-item--on" : ""}`}
              onClick={() => { setOpen(false); if (k.kind !== kind) onPick(k.kind); }}
            >
              {k.label}
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </span>
  );
}
