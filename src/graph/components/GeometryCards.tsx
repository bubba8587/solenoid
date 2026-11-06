// [[C25]], [[B19]] spreadsheetHabits

import { useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import type { CircleSolverNode, RegularPolygonNode, TwoPointsNode } from "../nodeClasses";
import { CIRCLE_DEFAULT, POLYGON_DEFAULT, POINTS_DEFAULT } from "../nodes/geometryFigures";
import { NodeShell, type NodeProps, type Emit } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { EquationOutRow } from "./EquationNode";
import { FrameDisplay } from "./FrameDisplay";
import { isSolError } from "../errorValue";
import { nodeDisplayName } from "../catalogUtils";
import { previewed } from "../listPreview";
import type { FrameValue } from "../frame";
import type { GraphNode } from "../graphModel";
import type { DisplayValue } from "./valueDisplayFormat";
import {
  FrameOutRow, RowPager, FigureField, useKeyedTable, numAt, fieldBox, clearance, separate, shortNum, shortText, stop,
  FIG_W as W, FIG_H as H, type Pt, type Box,
} from "./GeometryFigure";

type Table = ReturnType<typeof useKeyedTable>;

/** The figure cards' shared shell: the table's socket row, the figure in its Recess with the pager, Valid for a
 *  solver, and the frame's Preview. */
function FigureCard({ data, emit, table, valid, children }: {
  data: GraphNode & { cachedResult: unknown; width: number; height: number }; emit: Emit; table: Table; valid?: unknown; children: ReactNode;
}) {
  const shown = Array.isArray(valid) ? (valid[table.row] ?? null) : valid;
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <InlineInputs node={data} emit={emit} />
      <div className="solenoid-geo__figure">
        <div className="solenoid-geo__stage">{children}</div>
        <RowPager row={table.row} rows={table.rows} onStep={table.step} />
      </div>
      {valid !== undefined && <EquationOutRow node={data} emit={emit} socketKey="valid" label="Valid" value={shown as DisplayValue} />}
      <FrameOutRow node={data} socketKey="frame" emit={emit}>
        <FrameDisplay
          frame={previewed(() => (table.out ?? (isSolError(data.cachedResult) ? data.cachedResult : null)) as FrameValue | null)}
          label={nodeDisplayName(data)}
        />
      </FrameOutRow>
    </NodeShell>
  );
}

/** A keyable field for column `k`: keyed text, solved value, solved mark and the commit, from the table. */
function fieldProps(table: Table, solved: Set<string>, k: string) {
  return {
    keyed: table.keyedAt(k),
    solved: numAt(table.out, k, table.row),
    isSolved: solved.has(k),
    editable: !table.wired,
    onCommit: (t: string) => void table.commitCells({ [k]: t }),
  };
}

const unit = (x: number, y: number): Pt => { const l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l }; };
const boxOf = (table: Table, k: string, angle = false) => {
  const v = numAt(table.out, k, table.row);
  return fieldBox(shortText(table.keyedAt(k)) || (v === undefined ? "" : shortNum(v)), angle);
};

// ─── Circle Solver ──────────────────────────────────────────────────────────────────────────────────────────────────

const CIRCLE_PANEL = [["d", "d"], ["circumference", "circ."], ["area", "area"], ["sector", "sector"], ["segment", "segment"], ["height", "height"]] as const;
const CIRCLE_FIGURE = ["r", "angle", "arc", "chord"] as const;

/** The Circle Solver card: the circle with the arc's sector shaded, its chord and height; the radius and the arc's
 *  parts keyable on the drawing, the whole circle's in the corner panel. */
export function CircleSolverComponent({ data, emit }: NodeProps<CircleSolverNode>) {
  const table = useKeyedTable(data, CIRCLE_DEFAULT, "circles");
  const solved = new Set(data.solvedByRow[table.row] ?? []);
  const angle = numAt(table.out, "angle", table.row);
  const theta = ((angle ?? 60) * Math.PI) / 180;
  const C = { x: 172, y: 124 }, R = 74;
  const at = (phi: number): Pt => ({ x: C.x + R * Math.cos(phi), y: C.y - R * Math.sin(phi) });
  const E1 = at(Math.PI / 2 - theta / 2), E2 = at(Math.PI / 2 + theta / 2), M = at(Math.PI / 2);
  const Cm = { x: (E1.x + E2.x) / 2, y: (E1.y + E2.y) / 2 };
  const known = numAt(table.out, "r", table.row) !== undefined;
  const boxes = {
    r: boxOf(table, "r"), angle: boxOf(table, "angle", true), arc: boxOf(table, "arc"),
    chord: boxOf(table, "chord"),
  } as Record<(typeof CIRCLE_FIGURE)[number], Box>;
  const radial = unit(E1.x - C.x, E1.y - C.y);
  let normal = { x: -radial.y, y: radial.x };
  if (normal.x * (M.x - C.x) + normal.y * (M.y - C.y) > 0) normal = { x: -normal.x, y: -normal.y };
  const inward = theta >= Math.PI - 1e-9 && theta <= Math.PI + 1e-9 ? { x: 0, y: 1 } : unit(C.x - Cm.x, C.y - Cm.y);
  const spots = separate({
    r: { x: (C.x + E1.x) / 2 + normal.x * clearance(boxes.r, normal.x, normal.y, 3), y: (C.y + E1.y) / 2 + normal.y * clearance(boxes.r, normal.x, normal.y, 3) },
    angle: { x: C.x, y: C.y + boxes.angle.h / 2 + 4 },
    arc: { x: M.x, y: M.y - boxes.arc.h / 2 - 4 },
    chord: { x: Cm.x + inward.x * (boxes.chord.h / 2 + 3), y: Cm.y + inward.y * (boxes.chord.h / 2 + 3) },
  }, boxes);
  const large = theta > Math.PI ? 1 : 0;
  const dim = known ? {} : { strokeDasharray: "4 4", opacity: 0.6 };

  return (
    <FigureCard data={data} emit={emit} table={table} valid={data.cachedValid}>
      <svg viewBox={`0 0 ${W} ${H}`} className="solenoid-geo__svg" aria-hidden="true">
        <circle cx={C.x} cy={C.y} r={R} fill="none" stroke="var(--text-muted)" strokeWidth="1.5" {...dim} />
        <path d={`M ${C.x} ${C.y} L ${E1.x} ${E1.y} A ${R} ${R} 0 ${large} 0 ${E2.x} ${E2.y} Z`} fill="var(--node-accent)" fillOpacity="0.14" stroke="var(--text-muted)" strokeWidth="1" />
        <path d={`M ${E1.x} ${E1.y} A ${R} ${R} 0 ${large} 0 ${E2.x} ${E2.y}`} fill="none" stroke="var(--node-accent)" strokeWidth="2.5" />
        <line x1={E1.x} y1={E1.y} x2={E2.x} y2={E2.y} stroke="var(--text)" strokeWidth="1.5" />
        <line x1={Cm.x} y1={Cm.y} x2={M.x} y2={M.y} stroke="var(--node-accent)" strokeWidth="1.5" strokeDasharray="3 3" />
        <circle cx={C.x} cy={C.y} r="2.5" fill="var(--text-muted)" />
      </svg>
      {CIRCLE_FIGURE.map((k) => (
        <FigureField
          key={`${k}:${table.row}`} name={k === "angle" ? "θ" : k} at={spots[k]}
          {...fieldProps(table, solved, k)} suffix={k === "angle" ? "°" : undefined} strong={k === "angle"}
          ariaLabel={k === "angle" ? "Central angle in degrees" : k === "r" ? "Radius" : `${k[0].toUpperCase()}${k.slice(1)}`}
        />
      ))}
      <div className="solenoid-geo__panel">
        {CIRCLE_PANEL.map(([k, name]) => (
          <FigureField key={`${k}:${table.row}`} name={name} {...fieldProps(table, solved, k)} ariaLabel={k === "d" ? "Diameter" : k === "height" ? "Height (sagitta)" : `${k[0].toUpperCase()}${k.slice(1)}`} />
        ))}
      </div>
    </FigureCard>
  );
}

// ─── Regular Polygon ────────────────────────────────────────────────────────────────────────────────────────────────

const POLYGON_PANEL = [["perimeter", "perimeter"], ["area", "area"], ["exterior", "exterior"]] as const;
const POLYGON_FIGURE = ["n", "side", "circumradius", "apothem", "interior"] as const;
/** More sides than this draw as the circle they become. */
const MAX_DRAWN = 360;

/** The Regular Polygon card: the polygon with its circumcircle and incircle, a radius and an apothem; its count and
 *  sizes keyable on the drawing, its totals and exterior angle in the corner panel. */
export function RegularPolygonComponent({ data, emit }: NodeProps<RegularPolygonNode>) {
  const table = useKeyedTable(data, POLYGON_DEFAULT, "polygons");
  const solved = new Set(data.solvedByRow[table.row] ?? []);
  const nSolved = numAt(table.out, "n", table.row);
  const known = nSolved !== undefined && Number.isInteger(nSolved) && nSolved >= 3 && numAt(table.out, "side", table.row) !== undefined;
  const n = Math.min(known ? nSolved! : 6, MAX_DRAWN);
  const C = { x: 178, y: 122 }, R = 76, a = R * Math.cos(Math.PI / n);
  const vertex = (k: number): Pt => {
    const phi = -Math.PI / 2 + Math.PI / n + (2 * Math.PI * k) / n;
    return { x: C.x + R * Math.cos(phi), y: C.y - R * Math.sin(phi) };
  };
  const V0 = vertex(0), V1 = vertex(n - 1);
  const B = { x: (V0.x + V1.x) / 2, y: (V0.y + V1.y) / 2 };
  const boxes = {
    n: boxOf(table, "n"), side: boxOf(table, "side"), circumradius: boxOf(table, "circumradius"),
    apothem: boxOf(table, "apothem"), interior: boxOf(table, "interior", true),
  } as Record<(typeof POLYGON_FIGURE)[number], Box>;
  const radial = unit(V0.x - C.x, V0.y - C.y);
  const out0 = { x: V0.x + radial.x * clearance(boxes.interior, radial.x, radial.y, 4), y: V0.y + radial.y * clearance(boxes.interior, radial.x, radial.y, 4) };
  let normal = { x: -radial.y, y: radial.x };
  if (normal.y > 0) normal = { x: -normal.x, y: -normal.y };
  const mid = { x: (C.x + V0.x) / 2, y: (C.y + V0.y) / 2 };
  const spots = separate({
    n: { x: C.x, y: C.y - boxes.n.h / 2 - 6 },
    side: { x: B.x, y: B.y + boxes.side.h / 2 + 4 },
    circumradius: { x: mid.x + normal.x * clearance(boxes.circumradius, normal.x, normal.y, 3), y: mid.y + normal.y * clearance(boxes.circumradius, normal.x, normal.y, 3) },
    apothem: { x: C.x - boxes.apothem.w / 2 - 5, y: C.y + a / 2 },
    interior: out0,
  }, boxes);
  const dim = known ? {} : { strokeDasharray: "4 4", opacity: 0.6 };
  const points = Array.from({ length: n }, (_, k) => vertex(k)).map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <FigureCard data={data} emit={emit} table={table} valid={data.cachedValid}>
      <svg viewBox={`0 0 ${W} ${H}`} className="solenoid-geo__svg" aria-hidden="true">
        <circle cx={C.x} cy={C.y} r={R} fill="none" stroke="var(--border-strong)" strokeWidth="1" strokeDasharray="3 3" />
        <circle cx={C.x} cy={C.y} r={a} fill="none" stroke="var(--border-strong)" strokeWidth="1" strokeDasharray="3 3" />
        <polygon points={points} fill="var(--node-accent)" fillOpacity="0.1" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinejoin="round" {...dim} />
        <line x1={C.x} y1={C.y} x2={V0.x} y2={V0.y} stroke="var(--text)" strokeWidth="1.5" />
        <line x1={C.x} y1={C.y} x2={B.x} y2={B.y} stroke="var(--node-accent)" strokeWidth="1.5" strokeDasharray="3 3" />
        <line x1={V1.x} y1={V1.y} x2={V0.x} y2={V0.y} stroke="var(--node-accent)" strokeWidth="2.5" />
        <circle cx={C.x} cy={C.y} r="2.5" fill="var(--text-muted)" />
      </svg>
      {POLYGON_FIGURE.map((k) => (
        <FigureField
          key={`${k}:${table.row}`} name={k === "circumradius" ? "R" : k === "apothem" ? "a" : k === "interior" ? "∠" : k} at={spots[k]}
          {...fieldProps(table, solved, k)} suffix={k === "interior" ? "°" : undefined} strong={k === "n" || k === "interior"}
          ariaLabel={k === "n" ? "Number of sides" : k === "interior" ? "Interior angle in degrees" : `${k[0].toUpperCase()}${k.slice(1)}`}
        />
      ))}
      <div className="solenoid-geo__panel">
        {POLYGON_PANEL.map(([k, name]) => (
          <FigureField key={`${k}:${table.row}`} name={name} {...fieldProps(table, solved, k)} suffix={k === "exterior" ? "°" : undefined}
            ariaLabel={k === "exterior" ? "Exterior angle in degrees" : `${k[0].toUpperCase()}${k.slice(1)}`} />
        ))}
      </div>
    </FigureCard>
  );
}

// ─── Two Points ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** A round step near `span / 6`: 1, 2 or 5 times a power of ten. */
function niceStep(span: number): number {
  const raw = Math.max(span, 1e-9) / 6, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

const PAD = 22, BOTTOM = 30;

/** The Two Points card: the points on a grid with the segment between them and the line through them; drag a point,
 *  or key its coordinates on the row above, to move it. */
export function TwoPointsComponent({ data, emit }: NodeProps<TwoPointsNode>) {
  const table = useKeyedTable(data, POINTS_DEFAULT, "points");
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ which: 1 | 2; x: number; y: number; view: View } | null>(null);
  const cell = (k: string) => numAt(table.out, k, table.row);
  const pts = { x1: cell("x1"), y1: cell("y1"), x2: cell("x2"), y2: cell("y2") };
  if (drag) {
    pts[`x${drag.which}`] = drag.x;
    pts[`y${drag.which}`] = drag.y;
  }
  const have = pts.x1 !== undefined && pts.y1 !== undefined && pts.x2 !== undefined && pts.y2 !== undefined;
  const view = drag?.view ?? viewFor(have ? [pts.x1!, pts.x2!] : [0, 1], have ? [pts.y1!, pts.y2!] : [0, 1]);
  const toFig = (x: number, y: number): Pt => ({ x: view.ox + x * view.k, y: view.oy - y * view.k });
  const P1 = have ? toFig(pts.x1!, pts.y1!) : null, P2 = have ? toFig(pts.x2!, pts.y2!) : null;
  const equation = table.out?.columns.find((c) => c.name === "equation")?.values[table.row];

  const grab = (which: 1 | 2) => (e: ReactPointerEvent<SVGCircleElement>) => {
    if (table.wired || !have) return;
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ which, x: pts[`x${which}`]!, y: pts[`y${which}`]!, view });
  };
  const move = (e: ReactPointerEvent<SVGCircleElement>) => {
    if (!drag || !svgRef.current) return;
    const m = svgRef.current.getScreenCTM();
    if (!m) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    const snap = drag.view.step / 10;
    const round = (v: number) => Number((Math.round(v / snap) * snap).toPrecision(12));
    setDrag({ ...drag, x: round((p.x - drag.view.ox) / drag.view.k), y: round((drag.view.oy - p.y) / drag.view.k) });
  };
  const drop = () => {
    if (!drag) return;
    const { which, x, y } = drag;
    void table.commitCells({ [`x${which}`]: String(x), [`y${which}`]: String(y) }).then(() => setDrag(null));
  };

  const coord = (k: string, name: string) => (
    <FigureField key={`${k}:${table.row}`} name={name} keyed={table.keyedAt(k)} solved={pts[k as keyof typeof pts]}
      isSolved={false} editable={!table.wired} onCommit={(t) => void table.commitCells({ [k]: t })} ariaLabel={k} />
  );
  const xs: number[] = [], ys: number[] = [];
  for (let g = Math.ceil(view.x0 / view.step) * view.step; g <= view.x1 + 1e-9; g += view.step) xs.push(g);
  for (let g = Math.ceil(view.y0 / view.step) * view.step; g <= view.y1 + 1e-9; g += view.step) ys.push(g);
  // The line through the points, across the whole view.
  let line: [Pt, Pt] | null = null;
  if (have && (pts.x1 !== pts.x2 || pts.y1 !== pts.y2)) {
    if (pts.x1 === pts.x2) line = [toFig(pts.x1!, view.y0), toFig(pts.x1!, view.y1)];
    else {
      const m = (pts.y2! - pts.y1!) / (pts.x2! - pts.x1!), at = (x: number) => pts.y1! + m * (x - pts.x1!);
      line = [toFig(view.x0, at(view.x0)), toFig(view.x1, at(view.x1))];
    }
  }
  // A point's label sits off the line, on its upper side, clear of it.
  const labelAt = (P: Pt, Q: Pt, text: string): Pt => {
    const d = unit(P.x - Q.x, P.y - Q.y);
    let n = { x: -d.y, y: d.x };
    if (n.y > 0 || (n.y === 0 && n.x > 0)) n = { x: -n.x, y: -n.y };
    const b = fieldBox(text);
    return { x: P.x + n.x * clearance(b, n.x, n.y, 6), y: P.y + n.y * clearance(b, n.x, n.y, 6) };
  };

  return (
    <FigureCard data={data} emit={emit} table={table}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="solenoid-geo__svg">
        <g stroke="var(--border)" strokeWidth="1">
          {xs.map((g) => { const a = toFig(g, view.y0), b = toFig(g, view.y1); return <line key={`x${g}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />; })}
          {ys.map((g) => { const a = toFig(view.x0, g), b = toFig(view.x1, g); return <line key={`y${g}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />; })}
        </g>
        {view.x0 <= 0 && view.x1 >= 0 && (() => { const a = toFig(0, view.y0), b = toFig(0, view.y1); return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--border-strong)" strokeWidth="1.2" />; })()}
        {view.y0 <= 0 && view.y1 >= 0 && (() => { const a = toFig(view.x0, 0), b = toFig(view.x1, 0); return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--border-strong)" strokeWidth="1.2" />; })()}
        <clipPath id={`grid-${data.id}`}>
          <rect x={toFig(view.x0, view.y1).x} y={toFig(view.x0, view.y1).y} width={(view.x1 - view.x0) * view.k} height={(view.y1 - view.y0) * view.k} />
        </clipPath>
        {line && <line x1={line[0].x} y1={line[0].y} x2={line[1].x} y2={line[1].y} stroke="var(--text-muted)" strokeWidth="1" strokeDasharray="4 3" clipPath={`url(#grid-${data.id})`} />}
        {P1 && P2 && (
          <>
            <line x1={P1.x} y1={P1.y} x2={P2.x} y2={P2.y} stroke="var(--node-accent)" strokeWidth="2.5" />
            {[P1, P2].map((P, i) => (
              <circle key={i} cx={P.x} cy={P.y} r={drag?.which === i + 1 ? 6 : 5} fill="var(--text)"
                className={table.wired ? undefined : "solenoid-geo__handle nodrag"}
                onPointerDown={grab((i + 1) as 1 | 2)} onPointerMove={move} onPointerUp={drop} onMouseDown={stop} />
            ))}
          </>
        )}
      </svg>
      {P1 && P2 && (
        <>
          <div className="solenoid-geo__label" style={pctAt(labelAt(P1, P2, `(${shortNum(pts.x1!)}, ${shortNum(pts.y1!)})`))}>
            <span className="solenoid-geo__value">({shortNum(pts.x1!)}, {shortNum(pts.y1!)})</span>
          </div>
          <div className="solenoid-geo__label" style={pctAt(labelAt(P2, P1, `(${shortNum(pts.x2!)}, ${shortNum(pts.y2!)})`))}>
            <span className="solenoid-geo__value">({shortNum(pts.x2!)}, {shortNum(pts.y2!)})</span>
          </div>
        </>
      )}
      <div className="solenoid-geo__panel">
        <div className="solenoid-geo__pair">{coord("x1", "x1")}{coord("y1", "y1")}</div>
        <div className="solenoid-geo__pair">{coord("x2", "x2")}{coord("y2", "y2")}</div>
      </div>
      {typeof equation === "string" && <div className="solenoid-geo__equation">{equation}</div>}
    </FigureCard>
  );
}

type View = { x0: number; x1: number; y0: number; y1: number; k: number; ox: number; oy: number; step: number };

/** The data window around the points, padded and square (one unit is the same length across and up), fitted to the
 *  figure under its coordinate panel. */
function viewFor(xs: number[], ys: number[]): View {
  const top = 46;
  const [ax, bx, ay, by] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const span = Math.max(bx - ax, by - ay, 1e-9);
  const step = niceStep(span * 1.4);
  const pad = Math.max(span * 0.25, step);
  const [cx, cy] = [(ax + bx) / 2, (ay + by) / 2];
  const k = Math.min((W - 2 * PAD) / (bx - ax + 2 * pad), (H - top - BOTTOM) / (by - ay + 2 * pad));
  const halfW = (W - 2 * PAD) / 2 / k, halfH = (H - top - BOTTOM) / 2 / k;
  const view = { x0: cx - halfW, x1: cx + halfW, y0: cy - halfH, y1: cy + halfH, k, step, ox: 0, oy: 0 };
  view.ox = W / 2 - cx * k;
  view.oy = top + (H - top - BOTTOM) / 2 + cy * k;
  return view;
}

const pctAt = (p: Pt) => ({ left: `${(p.x / W) * 100}%`, top: `${(p.y / H) * 100}%` });
