// [[C25]], [[B19]] spreadsheetHabits

import type { TriangleSolverNode as TriangleSolverNodeType } from "../nodeClasses";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { EquationOutRow } from "./EquationNode";
import { FrameDisplay } from "./FrameDisplay";
import { iterMin, iterMax } from "../nodes/mathUtils";
import { TRIANGLE_DEFAULT } from "../nodes/triangle";
import { isSolError } from "../errorValue";
import { nodeDisplayName } from "../catalogUtils";
import { previewed } from "../listPreview";
import type { DisplayValue } from "./valueDisplayFormat";
import {
  FrameOutRow, RowPager, FigureField, useKeyedTable, numAt, fieldBox, clearance, shortNum, shortText,
  FIG_W, FIG_H, type Pt, type Box,
} from "./GeometryFigure";

const PARTS = ["a", "b", "c", "A", "B", "C"] as const;
type Part = (typeof PARTS)[number];
const W = FIG_W, H = FIG_H, PADX = 12, PADY = 12;

const STAND_IN = { a: 5, c: 4, B: 62 };

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

/** A label's box in figure units: the letter, the field sized to its text, the degree mark on an angle. */
const labelBox = (part: Part, text: string): Box => fieldBox(text, part === part.toUpperCase());

type Corners = Record<"A" | "B" | "C", Pt>;

/** Where each label sits: a side's off its midpoint along the outward normal, a vertex's along its outward bisector,
 *  each far enough that its box clears the lines, then overlapping boxes pushed apart. */
function labelSpots(P: Corners, boxes: Record<Part, Box>): Record<Part, Pt> {
  const g = { x: (P.A.x + P.B.x + P.C.x) / 3, y: (P.A.y + P.B.y + P.C.y) / 3 };
  const unit = (x: number, y: number) => { const l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l }; };
  const side = (part: Part, p: Pt, q: Pt): Pt => {
    const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    let n = unit(q.y - p.y, p.x - q.x);
    if (n.x * (m.x - g.x) + n.y * (m.y - g.y) < 0) n = { x: -n.x, y: -n.y };
    const d = clearance(boxes[part], n.x, n.y, 3);
    return { x: m.x + n.x * d, y: m.y + n.y * d };
  };
  const vertex = (part: "A" | "B" | "C", p: Pt, q: Pt, r: Pt): Pt => {
    const u = unit(p.x - q.x, p.y - q.y), v = unit(p.x - r.x, p.y - r.y);
    const n = unit(u.x + v.x, u.y + v.y);
    const d = clearance(boxes[part], n.x, n.y, 3);
    return { x: p.x + n.x * d, y: p.y + n.y * d };
  };
  const spots: Record<Part, Pt> = {
    A: vertex("A", P.A, P.B, P.C), B: vertex("B", P.B, P.A, P.C), C: vertex("C", P.C, P.A, P.B),
    a: side("a", P.B, P.C), b: side("b", P.A, P.C), c: side("c", P.A, P.B),
  };
  for (let pass = 0; pass < 12; pass++) {
    let moved = false;
    for (let i = 0; i < PARTS.length; i++) for (let j = i + 1; j < PARTS.length; j++) {
      const [ki, kj] = [PARTS[i], PARTS[j]], [p, q] = [spots[ki], spots[kj]];
      const ox = (boxes[ki].w + boxes[kj].w) / 2 + 2 - Math.abs(p.x - q.x);
      const oy = (boxes[ki].h + boxes[kj].h) / 2 + 2 - Math.abs(p.y - q.y);
      if (ox <= 0 || oy <= 0) continue;
      moved = true;
      if (oy < ox) { const s = (q.y >= p.y ? 1 : -1) * oy / 2; spots[ki] = { ...p, y: p.y - s }; spots[kj] = { ...q, y: q.y + s }; }
      else { const s = (q.x >= p.x ? 1 : -1) * ox / 2; spots[ki] = { ...p, x: p.x - s }; spots[kj] = { ...q, x: q.x + s }; }
    }
    if (!moved) break;
  }
  return spots;
}

/** The triangle as large as its labels allow: at each size the whole drawing, labels included, is centered in the
 *  figure, and the first size where it fits wins. */
function fitFigure(shape: Partial<Record<Part, number>>, boxes: Record<Part, Box>): { P: Corners; spots: Record<Part, Pt> } {
  let last: { P: Corners; spots: Record<Part, Pt> } | null = null;
  for (let fill = 1; fill > 0.3; fill -= 0.04) {
    const P0 = corners(shape, fill)!;
    const spots0 = labelSpots(P0, boxes);
    const xs = [...Object.values(P0).map((p) => p.x), ...PARTS.flatMap((k) => [spots0[k].x - boxes[k].w / 2, spots0[k].x + boxes[k].w / 2])];
    const ys = [...Object.values(P0).map((p) => p.y), ...PARTS.flatMap((k) => [spots0[k].y - boxes[k].h / 2, spots0[k].y + boxes[k].h / 2])];
    const [x0, x1, y0, y1] = [iterMin(xs), iterMax(xs), iterMin(ys), iterMax(ys)];
    const dx = (W - x0 - x1) / 2, dy = (H - y0 - y1) / 2;
    const move = (p: Pt) => ({ x: p.x + dx, y: p.y + dy });
    last = {
      P: { A: move(P0.A), B: move(P0.B), C: move(P0.C) },
      spots: Object.fromEntries(PARTS.map((k) => [k, move(spots0[k])])) as Record<Part, Pt>,
    };
    if (x1 - x0 <= W - 4 && y1 - y0 <= H - 4) break;
  }
  return last!;
}

/** The Triangle Solver card: the shown row's triangle drawn large, its parts keyable on the figure, a pager through the
 *  rows, Valid, and the solved frame's Preview. */
export function TriangleSolverComponent({ data, emit }: NodeProps<TriangleSolverNodeType>) {
  const { wired, out, rows, row, step, commitCells, keyedAt } = useKeyedTable(data, TRIANGLE_DEFAULT, "triangles");
  const solvedHere = new Set(data.solvedByRow[row] ?? []);
  const parts = Object.fromEntries(PARTS.map((k) => [k, numAt(out, k, row)])) as Partial<Record<Part, number>>;
  const solvedP = corners(parts);
  // With nothing solvable a stand-in triangle keeps all six fields on the figure to key into.
  const shape = solvedP ? parts : STAND_IN;
  const boxes = Object.fromEntries(PARTS.map((k) => {
    const v = parts[k];
    return [k, labelBox(k, shortText(keyedAt(k)) || (v === undefined ? "" : shortNum(v)))];
  })) as Record<Part, Box>;
  const { P, spots } = fitFigure(shape, boxes);
  const valid = Array.isArray(data.cachedValid) ? (data.cachedValid[row] ?? null) : data.cachedValid;

  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <InlineInputs node={data} emit={emit} />
      <div className="solenoid-geo__figure">
        <div className="solenoid-geo__stage">
          <svg viewBox={`0 0 ${W} ${H}`} className="solenoid-geo__svg" aria-hidden="true">
            <polygon
              points={`${P.A.x},${P.A.y} ${P.B.x},${P.B.y} ${P.C.x},${P.C.y}`}
              fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinejoin="round"
              {...(solvedP ? {} : { strokeDasharray: "4 4", opacity: 0.6 })}
            />
          </svg>
          {PARTS.map((k) => {
            const angle = k === k.toUpperCase();
            return (
              <FigureField
                key={`${k}:${row}`}
                name={k} at={spots[k]} keyed={keyedAt(k)} solved={parts[k]} isSolved={solvedHere.has(k)}
                editable={!wired} onCommit={(t) => void commitCells({ [k]: t })}
                suffix={angle ? "°" : undefined} strong={angle} ariaLabel={angle ? `Angle ${k} in degrees` : `Side ${k}`}
              />
            );
          })}
        </div>
        <RowPager row={row} rows={rows} onStep={step} />
      </div>
      <EquationOutRow node={data} emit={emit} socketKey="valid" label="Valid" value={valid as DisplayValue} />
      <FrameOutRow node={data} socketKey="frame" emit={emit}>
        <FrameDisplay
          frame={previewed(() => (out ?? (isSolError(data.cachedResult) ? data.cachedResult : null)))}
          label={nodeDisplayName(data)}
        />
      </FrameOutRow>
    </NodeShell>
  );
}
