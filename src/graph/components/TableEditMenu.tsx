// The table editors' Insert and Delete menus, in the footer and at the pointer (table-popup § The grid).
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useEscapeLayer } from "./escapeLayers";
import { ChevronDownIcon } from "./Icons";
import "./popupChrome.css";

/** One axis of a table the menus can edit: its rows (or records, or items) or its columns. */
export interface EditAxis {
  /** "Row", "Record", "Item" or "Column". */
  noun: string;
  /** The word on either side: "above" and "below", "left" and "right", "before" and "after". */
  sides: [string, string];
  /** The targeted indices; empty only when there are none, and Insert then offers one at the end. */
  target: readonly number[];
  /** How many there are now. */
  total: number;
  /** A column's name, quoted in the Delete label. */
  nameOf?: (i: number) => string | undefined;
  /** What the header shows when there is no name: a column letter. Numbers otherwise. */
  labelOf?: (i: number) => string;
  insert: (at: number, count: number) => void;
  remove: (indices: number[]) => void;
  /** Delete may take every one (a Cube level can be empty); otherwise one always stays. */
  canEmpty?: boolean;
}

interface MenuItem { label: string; onClick: () => void; disabled?: boolean }

function plural(noun: string, n: number): string {
  return `${n} ${noun.toLowerCase()}${noun.endsWith("s") ? "" : "s"}`;
}

/** "Row 3", "Rows 3–5", "Rows 3, 5, 8", "Column "price"", "Columns B–D", "7 rows". */
export function targetLabel(axis: Pick<EditAxis, "noun" | "target" | "nameOf" | "labelOf">): string {
  const s = [...axis.target].sort((a, b) => a - b);
  const plain = (i: number) => axis.labelOf?.(i) ?? String(i + 1);
  const named = (i: number) => {
    const n = axis.nameOf?.(i)?.trim();
    return n ? `"${n}"` : plain(i);
  };
  if (s.length === 1) return `${axis.noun} ${named(s[0])}`;
  const contiguous = s.every((v, k) => k === 0 || v === s[k - 1] + 1);
  if (axis.nameOf && s.length <= 3) return `${axis.noun}s ${s.map(named).join(", ")}`;
  if (!axis.nameOf && contiguous) return `${axis.noun}s ${plain(s[0])}–${plain(s[s.length - 1])}`;
  if (!axis.nameOf && s.length <= 4) return `${axis.noun}s ${s.map(plain).join(", ")}`;
  return plural(axis.noun, s.length);
}

function insertItems(axis: EditAxis): MenuItem[] {
  if (axis.target.length === 0) return [{ label: axis.noun, onClick: () => axis.insert(axis.total, 1) }];
  const n = axis.target.length;
  const lo = Math.min(...axis.target), hi = Math.max(...axis.target);
  const what = n > 1 ? plural(axis.noun, n) : axis.noun;
  return [
    { label: `${what} ${axis.sides[0]}`, onClick: () => axis.insert(lo, n) },
    { label: `${what} ${axis.sides[1]}`, onClick: () => axis.insert(hi + 1, n) },
  ];
}

function deleteItem(axis: EditAxis): MenuItem {
  return { label: targetLabel(axis), onClick: () => axis.remove([...axis.target]), disabled: !axis.canEmpty && axis.target.length >= axis.total };
}

/** The Insert and Delete items for whichever axes the editor offers. */
export function editMenuItems(row?: EditAxis, col?: EditAxis): { insert: MenuItem[]; remove: MenuItem[] } {
  const axes = [row, col].filter((a): a is EditAxis => !!a);
  return { insert: axes.flatMap(insertItems), remove: axes.filter((a) => a.target.length > 0).map(deleteItem) };
}

function useOutsideClose(open: boolean, ref: React.RefObject<HTMLElement | null>, close: () => void) {
  const cb = useRef(close);
  cb.current = close;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      // Inside a shadow root (the Obsidian plugin) `target` is the host, so read the composed path.
      if (ref.current && !ref.current.contains((e.composedPath()[0] ?? e.target) as Node)) cb.current();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open, ref]);
}

function MenuList({ items, className, style, heading }: { items: MenuItem[]; className: string; style?: React.CSSProperties; heading?: ReactNode }) {
  return (
    <div className={className} role="menu" style={style}>
      {heading}
      {items.map((it, i) => (
        <button key={i} type="button" role="menuitem" className="sol-popup-menu__item" disabled={it.disabled} onClick={it.onClick}>{it.label}</button>
      ))}
    </div>
  );
}

function FooterMenu({ label, icon, items }: { label: string; icon: ReactNode; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEscapeLayer(open, () => setOpen(false));
  useOutsideClose(open, ref, () => setOpen(false));
  return (
    <div className="sol-popup-menu" ref={ref}>
      <button
        type="button"
        className="table-popup__btn table-popup__editmenu"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={items.length === 0}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
        <ChevronDownIcon size={10} strokeWidth={2} />
      </button>
      {open && (
        <MenuList
          className="sol-popup-menu__list sol-popup-menu__list--up"
          items={items.map((it) => ({ ...it, onClick: () => { setOpen(false); it.onClick(); } }))}
        />
      )}
    </div>
  );
}

const PlusIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
);
const MinusIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 6h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
);

/** The footer's two menus. */
export function TableEditMenus({ row, col }: { row?: EditAxis; col?: EditAxis }) {
  const { insert, remove } = editMenuItems(row, col);
  return (
    <div className="table-popup__dim-controls">
      <FooterMenu label="Insert" icon={<PlusIcon />} items={insert} />
      <FooterMenu label="Delete" icon={<MinusIcon />} items={remove} />
    </div>
  );
}

/** Both menus' items at the pointer, from a right click. */
export function TableContextMenu({ at, row, col, onClose }: { at: { x: number; y: number }; row?: EditAxis; col?: EditAxis; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  useEscapeLayer(true, onClose);
  useOutsideClose(true, ref, onClose);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.max(4, Math.min(at.x, window.innerWidth - r.width - 4)), y: Math.max(4, Math.min(at.y, window.innerHeight - r.height - 4)) });
  }, [at]);
  const { insert, remove } = editMenuItems(row, col);
  const wrap = (it: MenuItem): MenuItem => ({ ...it, onClick: () => { onClose(); it.onClick(); } });
  return (
    <div ref={ref} className="sol-popup-menu__list sol-popup-menu__list--at" role="menu" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      <div className="sol-popup-menu__heading">Insert</div>
      {insert.map((it, i) => <button key={`i${i}`} type="button" role="menuitem" className="sol-popup-menu__item" onClick={wrap(it).onClick}>{it.label}</button>)}
      <div className="sol-popup-menu__sep" />
      <div className="sol-popup-menu__heading">Delete</div>
      {remove.map((it, i) => <button key={`d${i}`} type="button" role="menuitem" className="sol-popup-menu__item" disabled={it.disabled} onClick={wrap(it).onClick}>{it.label}</button>)}
    </div>
  );
}
