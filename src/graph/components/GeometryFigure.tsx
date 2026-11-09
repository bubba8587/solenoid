// [[C25]]

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { GraphNode } from "../graphModel";
import type { Emit } from "./nodeKit";
import { NodeSocket } from "./NodeSocket";
import { useRowTop } from "./EquationNode";
import { formatScalar } from "./format";
import { useConnectedInputs, useDraftCommit, INVALID_DRAFT } from "./inlineInput";
import { parseFrameSource, frameSourceToText, isFrameValue, frameRowCount, type FrameSourceColumn, type FrameValue } from "../frame";
import type { SolError } from "../errorValue";
import { processGraph } from "../process";
import { scheduleAutosave } from "../persistence";
import { getOwningEditor, getOwningView } from "../activeGraph";
import { reconcileTypesAfterEdit } from "../fcReconcile";
import "./GeometryFigure.css";

/** A figure label's number at rest: two decimals at most, trailing zeros dropped; its field shows it in full while
 *  focused, as the app's other fields do. Extremes keep the app's own display. */
export function shortNum(n: number): string {
  const a = Math.abs(n);
  if (!Number.isFinite(n) || a >= 1e6 || (a > 0 && a < 0.005)) return formatScalar(n);
  return String(Number(n.toFixed(2)) || 0);
}

/** Typed text at rest: a number shortened, anything else as typed. */
export function shortText(t: string): string {
  const n = Number(t.trim());
  return t.trim() !== "" && Number.isFinite(n) ? shortNum(n) : t;
}

/** A label's size in figure units (10px mono, one unit a pixel at the card's width): the letter and its gap, the
 *  field's text and its 2px padding and border, and the degree mark. */
const CHAR_W = 6.1;
export const LABEL_H = 15;
const LABEL_DEG_W = 6;
export const labelWidth = (chars: number) => 9 + Math.max(2, chars) * CHAR_W + 6;
const fieldWidth = (chars: number) => `calc(${Math.max(2, chars)}ch + 6px)`;

export const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

function Chevron({ back }: { back?: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d={back ? "M6.5 1l-4 4 4 4" : "M3.5 1l4 4-4 4"} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The Record pager in the figure's bottom-right corner, shown only with more than one row. */
export function RowPager({ row, rows, onStep }: { row: number; rows: number; onStep: (d: number) => void }) {
  if (rows <= 1) return null;
  return (
    <div className="solenoid-record__pager solenoid-geo__pager">
      <button type="button" className="solenoid-record__pager-btn" title="Previous row" disabled={row <= 0}
        onClick={(e) => { e.stopPropagation(); onStep(-1); }} onPointerDown={stop} onMouseDown={stop}><Chevron back /></button>
      <span className="solenoid-record__pager-count">{row + 1} / {rows}</span>
      <button type="button" className="solenoid-record__pager-btn" title="Next row" disabled={row >= rows - 1}
        onClick={(e) => { e.stopPropagation(); onStep(1); }} onPointerDown={stop} onMouseDown={stop}><Chevron /></button>
    </div>
  );
}

/** The socket top that centers a dot on `ref`'s element wherever it sits in the card: its offset summed up to the
 *  card's content box (the sockets' positioning context), so it holds under canvas zoom. */
export function useAnchorTop(ref: React.RefObject<HTMLElement | null>): number | undefined {
  const [top, setTop] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    let el: HTMLElement | null = ref.current;
    if (!el) return;
    const half = el.offsetHeight / 2;
    let y = 0;
    while (el && !el.classList.contains("solenoid-node__content")) {
      y += el.offsetTop;
      el = el.offsetParent as HTMLElement | null;
    }
    const t = y + half - 6;
    if (t !== top) setTop(t);
  });
  return top;
}

/** A frame output's row: its socket beside the Preview. */
export function FrameOutRow({ node, socketKey, emit, children }: { node: GraphNode; socketKey: string; emit: Emit; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const top = useRowTop(ref);
  const port = node.outputs[socketKey];
  return (
    <div ref={ref} className="solenoid-node__io-row solenoid-node__io-row--output solenoid-geo__preview">
      {top !== undefined && port && <NodeSocket side="output" socketKey={socketKey} nodeId={node.id} emit={emit} payload={port.socket} top={top} />}
      {children}
    </div>
  );
}

/** Every figure is drawn in this box; its stage keeps the aspect, so a label's percent is its point. */
export const FIG_W = 300, FIG_H = 236;
export type Pt = { x: number; y: number };
export type Box = { w: number; h: number };

/** A cell of `frame`'s column `name` at `row`, as a number when it is one. */
export function numAt(frame: FrameValue | null, name: string, row: number): number | undefined {
  const v = frame?.columns.find((c) => c.name === name)?.values[row];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** A label's box for a value of this text, with the degree mark when it is an angle. */
export const fieldBox = (text: string, angle = false): Box => ({ w: labelWidth(text.length) + (angle ? LABEL_DEG_W : 0), h: LABEL_H });

/** How far a box's center must sit from a line, along the unit normal (nx, ny), for the box to clear it by `gap`. */
export const clearance = (b: Box, nx: number, ny: number, gap: number) => gap + Math.abs(nx) * (b.w / 2) + Math.abs(ny) * (b.h / 2);

/** Overlapping labels pushed apart, along whichever axis they overlap less, until none do; then each kept inside. */
export function separate<K extends string>(spots: Record<K, Pt>, boxes: Record<K, Box>): Record<K, Pt> {
  const keys = Object.keys(spots) as K[];
  for (let pass = 0; pass < 12; pass++) {
    let moved = false;
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      const [ki, kj] = [keys[i], keys[j]], [p, q] = [spots[ki], spots[kj]];
      const ox = (boxes[ki].w + boxes[kj].w) / 2 + 2 - Math.abs(p.x - q.x);
      const oy = (boxes[ki].h + boxes[kj].h) / 2 + 2 - Math.abs(p.y - q.y);
      if (ox <= 0 || oy <= 0) continue;
      moved = true;
      if (oy < ox) { const d = (q.y >= p.y ? 1 : -1) * oy / 2; spots[ki] = { ...p, y: p.y - d }; spots[kj] = { ...q, y: q.y + d }; }
      else { const d = (q.x >= p.x ? 1 : -1) * ox / 2; spots[ki] = { ...p, x: p.x - d }; spots[kj] = { ...q, x: q.x + d }; }
    }
    if (!moved) break;
  }
  for (const k of keys) {
    const { w, h } = boxes[k], p = spots[k];
    spots[k] = { x: Math.min(Math.max(p.x, w / 2 + 2), FIG_W - w / 2 - 2), y: Math.min(Math.max(p.y, h / 2 + 2), FIG_H - h / 2 - 2) };
  }
  return spots;
}

/** A figure card's node: its keyed table, the row shown, and what the core last answered. */
type KeyedFigure = GraphNode & { frameText: string; row: number; cachedResult: FrameValue | SolError | null };

/** A figure card's table: the wired frame or its own keyed one, the solved frame, the row shown, and the edit that
 *  keys cells into the shown row (a new column joins as a number column). */
export function useKeyedTable(data: KeyedFigure, defaultText: string, socketKey: string) {
  const wired = useConnectedInputs(data.id).has(socketKey);
  const source = useMemo(() => parseFrameSource(data.frameText || defaultText), [data.frameText, defaultText]);
  const out = isFrameValue(data.cachedResult) ? data.cachedResult : null;
  const rows = out ? frameRowCount(out) : 0;
  const [shownRow, setShownRow] = useState(data.row);
  const row = Math.min(Math.max(0, shownRow), Math.max(0, rows - 1));
  // The row shown is view state: stepping redraws the figure and computes nothing.
  const step = (d: number) => {
    data.row = Math.min(Math.max(0, row + d), Math.max(0, rows - 1));
    setShownRow(data.row);
  };
  const save = useCallback(async (columns: FrameSourceColumn[]) => {
    data.frameText = frameSourceToText(columns);
    const ed = getOwningEditor(data.id), view = getOwningView(data.id);
    if (ed && view) reconcileTypesAfterEdit(ed, view);
    scheduleAutosave();
    data.edited();
    await processGraph(data.id);
  }, [data]);
  /** The keyed table edited by `edit`, every column padded to one height first and after. */
  const editTable = useCallback((edit: (cols: FrameSourceColumn[], height: number) => void) => {
    const cols = source.map((c) => ({ ...c, cells: [...c.cells] }));
    const pad = () => { const h = Math.max(0, ...cols.map((c) => c.cells.length)); for (const c of cols) while (c.cells.length < h) c.cells.push(""); return h; };
    edit(cols, pad());
    pad();
    return save(cols);
  }, [source, save]);
  /** Cells keyed into row `at` (a new column joins as a number column). */
  const commitRow = useCallback((at: number, cells: Record<string, string>) => editTable((cols) => {
    for (const [name, text] of Object.entries(cells)) {
      let col = cols.find((c) => c.name === name);
      if (!col) {
        col = { name, type: "number", cells: [] };
        cols.push(col);
      }
      col.type = "number";
      while (col.cells.length <= at) col.cells.push("");
      col.cells[at] = text;
    }
  }), [editTable]);
  const commitCells = useCallback((cells: Record<string, string>) => commitRow(row, cells), [commitRow, row]);
  /** A row inserted at `at` holding `cells`, or row `at` removed. */
  const insertRow = useCallback((at: number, cells: Record<string, string>) =>
    editTable((cols) => { for (const c of cols) c.cells.splice(at, 0, cells[c.name] ?? ""); }), [editTable]);
  const removeRow = useCallback((at: number) => editTable((cols) => { for (const c of cols) c.cells.splice(at, 1); }), [editTable]);
  /** The whole keyed table replaced (a shape switch's fresh table). */
  const replaceTable = useCallback((text: string) => save(parseFrameSource(text)), [save]);
  const keyedAt = (name: string) => (wired ? "" : source.find((c) => c.name === name)?.cells[row] ?? "");
  return { wired, out, rows, row, step, commitCells, commitRow, insertRow, removeRow, replaceTable, keyedAt };
}

/** One keyable value on a figure: its name, then a field holding what was keyed (the solved value its placeholder),
 *  short at rest and in full while focused; read-only text while the table is wired. Positioned at `at` in the
 *  figure, or in flow (a panel's row) without it. */
export function FigureField({ name, at, keyed, solved, isSolved, editable, onCommit, suffix, strong, ariaLabel }: {
  name: string; at?: Pt; keyed: string; solved: number | undefined; isSolved: boolean; editable: boolean;
  onCommit: (text: string) => void; suffix?: string; strong?: boolean; ariaLabel: string;
}) {
  const [focused, setFocused] = useState(false);
  const full = solved === undefined ? "" : formatScalar(solved);
  const short = solved === undefined ? "" : shortNum(solved);
  const { draft, setDraft, onBlur, onKeyDown } = useDraftCommit(
    keyed,
    (v) => v,
    (t) => (t.trim() === "" || Number.isFinite(Number(t.trim())) ? t.trim() : INVALID_DRAFT),
    onCommit,
  );
  const cls = `solenoid-geo__label${at ? "" : " solenoid-geo__label--flow"}${strong ? " solenoid-geo__label--angle" : ""}${isSolved ? " solenoid-geo__label--solved" : ""}`;
  return (
    <div className={cls} style={at ? { left: `${(at.x / FIG_W) * 100}%`, top: `${(at.y / FIG_H) * 100}%` } : undefined}>
      <span className="solenoid-geo__letter">{name}</span>
      {editable ? (
        <input
          className="solenoid-geo__field nodrag"
          value={focused ? draft : shortText(draft)}
          placeholder={focused ? full : short}
          aria-label={ariaLabel}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); onBlur(); }}
          onKeyDown={onKeyDown}
          onPointerDown={stop}
          onMouseDown={stop}
          style={{ width: fieldWidth((focused ? draft || full : shortText(draft) || short).length) }}
        />
      ) : (
        <span className="solenoid-geo__value">{short || "–"}</span>
      )}
      {suffix && <span className="solenoid-geo__deg">{suffix}</span>}
    </div>
  );
}
