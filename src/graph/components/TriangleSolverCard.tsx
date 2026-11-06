// [[C25]], [[B19]] spreadsheetHabits

import { useCallback, useMemo, useRef, useState } from "react";
import type { TriangleSolverNode as TriangleSolverNodeType } from "../nodeClasses";
import { NodeShell, type NodeProps, type Emit } from "./nodeKit";
import { NodeSocket } from "./NodeSocket";
import { InlineInputs, useConnectedInputs, useDraftCommit, INVALID_DRAFT } from "./inlineInput";
import { EquationOutRow, useRowTop } from "./EquationNode";
import { FrameDisplay } from "./FrameDisplay";
import { formatScalar } from "./format";
import { iterMin, iterMax } from "../nodes/mathUtils";
import { TRIANGLE_DEFAULT } from "../nodes/triangle";
import { parseFrameSource, frameSourceToText, isFrameValue, frameRowCount, type FrameSourceColumn, type FrameValue } from "../frame";
import { isSolError } from "../errorValue";
import { processGraph } from "../process";
import { scheduleAutosave } from "../persistence";
import { getOwningEditor, getOwningView } from "../activeGraph";
import { reconcileTypesAfterEdit } from "../fcReconcile";
import { nodeDisplayName } from "../catalogUtils";
import { previewed } from "../listPreview";
import type { DisplayValue } from "./valueDisplayFormat";
import "./TriangleSolverCard.css";

const PARTS = ["a", "b", "c", "A", "B", "C"] as const;
type Part = (typeof PARTS)[number];
const W = 300, H = 236, PADX = 66, PADY = 38;
type Pt = { x: number; y: number };

const STAND_IN = { a: 5, c: 4, B: 62 };

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

/** A cell of `frame`'s column `name` at `row`, as a number when it is one. */
function numAt(frame: FrameValue | null, name: string, row: number): number | undefined {
  const v = frame?.columns.find((c) => c.name === name)?.values[row];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** The triangle's corners in the figure's box, drawn to scale (B at the origin, C along the base), or null. */
function corners(t: Partial<Record<Part, number>>, fill = 1): Record<"A" | "B" | "C", Pt> | null {
  const { a, c, B } = t;
  if (a === undefined || c === undefined || B === undefined) return null;
  const raw = { B: { x: 0, y: 0 }, C: { x: a, y: 0 }, A: { x: c * Math.cos((B * Math.PI) / 180), y: c * Math.sin((B * Math.PI) / 180) } };
  const xs = Object.values(raw).map((p) => p.x), ys = Object.values(raw).map((p) => p.y);
  const minX = iterMin(xs), minY = iterMin(ys), spanX = iterMax(xs) - minX, spanY = iterMax(ys) - minY;
  if (!(spanX > 0) || !Number.isFinite(spanX) || !Number.isFinite(spanY)) return null;
  const scale = fill * Math.min((W - 2 * PADX) / spanX, (H - 2 * PADY) / Math.max(spanY, spanX * 0.15));
  const px = (p: Pt) => ({ x: PADX + (p.x - minX) * scale + (W - 2 * PADX - spanX * scale) / 2, y: H - PADY - (p.y - minY) * scale - (H - 2 * PADY - spanY * scale) / 2 });
  return { A: px(raw.A), B: px(raw.B), C: px(raw.C) };
}

type Box = { w: number; h: number };

/** A label's box in figure units: the letter, the field sized to its text, the degree mark on an angle. */
function labelBox(part: Part, text: string): Box {
  const angle = part === part.toUpperCase();
  return { w: 14 + Math.max(3, text.length) * 6.7 + 10 + (angle ? 9 : 0), h: 18 };
}

/** How far a box's center must sit from a line, along the unit normal (nx, ny), for the box to clear it by `gap`. */
const clearance = (b: Box, nx: number, ny: number, gap: number) => gap + Math.abs(nx) * (b.w / 2) + Math.abs(ny) * (b.h / 2);

/** Where each label sits: a side's off its midpoint along the outward normal, a vertex's along its outward bisector,
 *  each far enough that its box clears the lines, then overlapping boxes pushed apart and all kept in the figure. */
function labelSpots(P: Record<"A" | "B" | "C", Pt>, boxes: Record<Part, Box>): { spots: Record<Part, Pt>; fits: boolean } {
  const g = { x: (P.A.x + P.B.x + P.C.x) / 3, y: (P.A.y + P.B.y + P.C.y) / 3 };
  const unit = (x: number, y: number) => { const l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l }; };
  const side = (part: Part, p: Pt, q: Pt): Pt => {
    const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    let n = unit(q.y - p.y, p.x - q.x);
    if (n.x * (m.x - g.x) + n.y * (m.y - g.y) < 0) n = { x: -n.x, y: -n.y };
    const d = clearance(boxes[part], n.x, n.y, 5);
    return { x: m.x + n.x * d, y: m.y + n.y * d };
  };
  const vertex = (part: "A" | "B" | "C", p: Pt, q: Pt, r: Pt): Pt => {
    const u = unit(p.x - q.x, p.y - q.y), v = unit(p.x - r.x, p.y - r.y);
    const n = unit(u.x + v.x, u.y + v.y);
    const d = clearance(boxes[part], n.x, n.y, 6);
    return { x: p.x + n.x * d, y: p.y + n.y * d };
  };
  const spots: Record<Part, Pt> = {
    A: vertex("A", P.A, P.B, P.C), B: vertex("B", P.B, P.A, P.C), C: vertex("C", P.C, P.A, P.B),
    a: side("a", P.B, P.C), b: side("b", P.A, P.C), c: side("c", P.A, P.B),
  };
  const inside = (k: Part) => {
    const { w, h } = boxes[k], p = spots[k];
    return p.x - w / 2 >= 1 && p.x + w / 2 <= W - 1 && p.y - h / 2 >= 1 && p.y + h / 2 <= H - 1;
  };
  const fits = PARTS.every(inside);
  const keep = (k: Part) => {
    const { w, h } = boxes[k], p = spots[k];
    spots[k] = { x: Math.min(Math.max(p.x, w / 2 + 2), W - w / 2 - 2), y: Math.min(Math.max(p.y, h / 2 + 2), H - h / 2 - 2) };
  };
  for (let pass = 0; pass < 12; pass++) {
    let moved = false;
    for (let i = 0; i < PARTS.length; i++) for (let j = i + 1; j < PARTS.length; j++) {
      const [ki, kj] = [PARTS[i], PARTS[j]], [p, q] = [spots[ki], spots[kj]];
      const ox = (boxes[ki].w + boxes[kj].w) / 2 + 3 - Math.abs(p.x - q.x);
      const oy = (boxes[ki].h + boxes[kj].h) / 2 + 2 - Math.abs(p.y - q.y);
      if (ox <= 0 || oy <= 0) continue;
      moved = true;
      if (oy < ox) { const s = (q.y >= p.y ? 1 : -1) * oy / 2; spots[ki] = { ...p, y: p.y - s }; spots[kj] = { ...q, y: q.y + s }; }
      else { const s = (q.x >= p.x ? 1 : -1) * ox / 2; spots[ki] = { ...p, x: p.x - s }; spots[kj] = { ...q, x: q.x + s }; }
    }
    PARTS.forEach(keep);
    if (!moved) break;
  }
  return { spots, fits };
}

/** One part's label on the figure: the letter, then its value, keyed into the shown row while no frame is wired. */
function PartLabel({ part, at, keyed, solved, isSolved, editable, onCommit }: {
  part: Part; at: Pt; keyed: string; solved: number | undefined; isSolved: boolean; editable: boolean;
  onCommit: (part: Part, text: string) => void;
}) {
  const shown = solved === undefined ? "" : formatScalar(solved);
  const { draft, setDraft, onBlur, onKeyDown } = useDraftCommit(
    keyed,
    (v) => v,
    (t) => (t.trim() === "" || Number.isFinite(Number(t.trim())) ? t.trim() : INVALID_DRAFT),
    (v) => onCommit(part, v),
  );
  const angle = part === part.toUpperCase();
  return (
    <div
      className={`solenoid-tri__label${angle ? " solenoid-tri__label--angle" : ""}${isSolved ? " solenoid-tri__label--solved" : ""}`}
      style={{ left: `${(at.x / W) * 100}%`, top: `${(at.y / H) * 100}%` }}
    >
      <span className="solenoid-tri__letter">{part}</span>
      {editable ? (
        <input
          className="solenoid-tri__field nodrag"
          value={draft}
          placeholder={shown}
          aria-label={angle ? `Angle ${part} in degrees` : `Side ${part}`}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          onPointerDown={stop}
          onMouseDown={stop}
          size={Math.max(3, (draft || shown).length)}
        />
      ) : (
        <span className="solenoid-tri__value">{shown || "–"}</span>
      )}
      {angle && <span className="solenoid-tri__deg">°</span>}
    </div>
  );
}

function Chevron({ back }: { back?: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d={back ? "M6.5 1l-4 4 4 4" : "M3.5 1l4 4-4 4"} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The frame output's row: its socket beside the Preview. */
function FrameOutRow({ node, emit, children }: { node: TriangleSolverNodeType; emit: Emit; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const top = useRowTop(ref);
  const port = node.outputs.frame;
  return (
    <div ref={ref} className="solenoid-node__io-row solenoid-node__io-row--output solenoid-tri__preview">
      {top !== undefined && port && <NodeSocket side="output" socketKey="frame" nodeId={node.id} emit={emit} payload={port.socket} top={top} />}
      {children}
    </div>
  );
}

/** The Triangle Solver card: the shown row's triangle drawn large, its parts keyable on the figure, a pager through the
 *  rows, Valid, and the solved frame's Preview. */
export function TriangleSolverComponent({ data, emit }: NodeProps<TriangleSolverNodeType>) {
  const wired = useConnectedInputs(data.id).has("triangles");
  const source = useMemo(() => parseFrameSource(data.frameText || TRIANGLE_DEFAULT), [data.frameText]);
  const out = isFrameValue(data.cachedResult) ? data.cachedResult : null;
  const rows = out ? frameRowCount(out) : 0;
  const [shownRow, setShownRow] = useState(data.row);
  const row = Math.min(Math.max(0, shownRow), Math.max(0, rows - 1));
  const solvedHere = new Set(data.solvedByRow[row] ?? []);
  const parts = Object.fromEntries(PARTS.map((k) => [k, numAt(out, k, row)])) as Partial<Record<Part, number>>;
  const solvedP = corners(parts);
  // With nothing solvable a stand-in triangle keeps all six fields on the figure to key into.
  const shape = solvedP ? parts : STAND_IN;
  const keyedAt = (part: Part) => source.find((c) => c.name === part)?.cells[row] ?? "";
  const boxes = Object.fromEntries(PARTS.map((k) => {
    const v = parts[k];
    return [k, labelBox(k, wired ? (v === undefined ? "" : formatScalar(v)) : keyedAt(k) || (v === undefined ? "" : formatScalar(v)))];
  })) as Record<Part, Box>;
  // The triangle shrinks until every label fits beside it, so none is pushed back over a line.
  let P = corners(shape)!, { spots, fits } = labelSpots(P, boxes);
  for (let fill = 0.9; !fits && fill > 0.45; fill -= 0.1) {
    P = corners(shape, fill)!;
    ({ spots, fits } = labelSpots(P, boxes));
  }

  const save = useCallback(async (columns: FrameSourceColumn[]) => {
    data.frameText = frameSourceToText(columns);
    const ed = getOwningEditor(data.id), view = getOwningView(data.id);
    if (ed && view) reconcileTypesAfterEdit(ed, view);
    scheduleAutosave();
    data.edited();
    await processGraph(data.id);
  }, [data]);

  const commitPart = useCallback((part: Part, text: string) => {
    const cols = source.map((c) => ({ ...c, cells: [...c.cells] }));
    let col = cols.find((c) => c.name === part);
    if (!col) {
      col = { name: part, type: "number", cells: [] };
      cols.push(col);
    }
    col.type = "number";
    const height = Math.max(row + 1, ...cols.map((c) => c.cells.length));
    for (const c of cols) while (c.cells.length < height) c.cells.push("");
    col.cells[row] = text;
    void save(cols);
  }, [source, row, save]);

  // The row shown is view state: stepping redraws the figure and computes nothing.
  const step = (d: number) => {
    data.row = Math.min(Math.max(0, row + d), Math.max(0, rows - 1));
    setShownRow(data.row);
  };

  const valid = Array.isArray(data.cachedValid) ? (data.cachedValid[row] ?? null) : data.cachedValid;

  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <InlineInputs node={data} emit={emit} />
      <div className="solenoid-tri__figure">
        <div className="solenoid-tri__stage">
        <svg viewBox={`0 0 ${W} ${H}`} className="solenoid-tri__svg" aria-hidden="true">
          <polygon
            points={`${P.A.x},${P.A.y} ${P.B.x},${P.B.y} ${P.C.x},${P.C.y}`}
            fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinejoin="round"
            {...(solvedP ? {} : { strokeDasharray: "4 4", opacity: 0.6 })}
          />
        </svg>
        {PARTS.map((k) => (
          <PartLabel
            key={`${k}:${row}`}
            part={k} at={spots[k]} keyed={wired ? "" : keyedAt(k)} solved={parts[k]}
            isSolved={solvedHere.has(k)} editable={!wired} onCommit={commitPart}
          />
        ))}
        </div>
        {rows > 1 && (
          <div className="solenoid-record__pager solenoid-tri__pager">
            <button type="button" className="solenoid-record__pager-btn" title="Previous row" disabled={row <= 0}
              onClick={(e) => { e.stopPropagation(); step(-1); }} onPointerDown={stop} onMouseDown={stop}><Chevron back /></button>
            <span className="solenoid-record__pager-count">{row + 1} / {rows}</span>
            <button type="button" className="solenoid-record__pager-btn" title="Next row" disabled={row >= rows - 1}
              onClick={(e) => { e.stopPropagation(); step(1); }} onPointerDown={stop} onMouseDown={stop}><Chevron /></button>
          </div>
        )}
      </div>
      <EquationOutRow node={data} emit={emit} socketKey="valid" label="Valid" value={valid as DisplayValue} />
      <FrameOutRow node={data} emit={emit}>
        <FrameDisplay
          frame={previewed(() => (out ?? (isSolError(data.cachedResult) ? data.cachedResult : null)))}
          label={nodeDisplayName(data)}
        />
      </FrameOutRow>
    </NodeShell>
  );
}
