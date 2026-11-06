// [[C25]]

import { useRef, type ReactNode } from "react";
import type { GraphNode } from "../graphModel";
import type { Emit } from "./nodeKit";
import { NodeSocket } from "./NodeSocket";
import { useRowTop } from "./EquationNode";
import { formatScalar } from "./format";
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
export const LABEL_DEG_W = 6;
export const labelWidth = (chars: number) => 9 + Math.max(2, chars) * CHAR_W + 6;
export const fieldWidth = (chars: number) => `calc(${Math.max(2, chars)}ch + 6px)`;

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
