// [[C25]], [[B19]] spreadsheetHabits

import type { ReactNode } from "react";
import type { SolidNode } from "../nodeClasses";
import { SOLID_DEFAULTS, SOLID_SHAPES, SOLID_OP_META, type SolidShape } from "../nodes/geometryFigures";
import { OpSelect, type NodeProps } from "./nodeKit";
import { FigureCard } from "./GeometryCards";
import { FigureField, useKeyedTable, numAt, fieldBox, separate, shortText, shortNum, FIG_W as W, FIG_H as H, type Pt, type Box } from "./GeometryFigure";

const SHAPE_OPTIONS = SOLID_SHAPES.map((value) => ({ value, label: SOLID_OP_META[value].label }));

/** Each shape's dimensions (drawn and keyable on the figure) and its other measures (in the corner panel). */
const LAYOUT: Record<SolidShape, { dims: string[]; panel: string[] }> = {
  sphere: { dims: ["r"], panel: ["d", "volume", "surface"] },
  cube: { dims: ["side"], panel: ["face diagonal", "diagonal", "volume", "surface"] },
  box: { dims: ["length", "width", "height"], panel: ["diagonal", "volume", "surface"] },
  cylinder: { dims: ["r", "h"], panel: ["d", "volume", "lateral", "surface"] },
  cone: { dims: ["r", "h", "slant"], panel: ["d", "volume", "lateral", "surface"] },
  pyramid: { dims: ["base", "h"], panel: ["slant", "edge", "volume", "lateral", "surface"] },
};

/** A stand-in for each shape while a row can't be drawn. */
const STAND_IN: Record<SolidShape, Record<string, number>> = {
  sphere: { r: 1 }, cube: { side: 1 }, box: { length: 4, width: 3, height: 2 },
  cylinder: { r: 2, h: 5 }, cone: { r: 3, h: 4 }, pyramid: { base: 4, h: 3 },
};

/** The receding axis of the oblique drawing: half depth at 35° up and to the right. */
const DEPTH = { x: 0.5 * Math.cos((35 * Math.PI) / 180), y: -0.5 * Math.sin((35 * Math.PI) / 180) };
/** How flat a circle seen from the side draws. */
const TILT = 0.3;
/** The drawing's region, right of the corner panel. */
const REGION = { x0: 128, x1: W - 14, y0: 18, y1: H - 30 };

/** Which side of its line a dimension's label sits on. */
type Side = "up" | "down" | "left" | "right";
type Drawing = { body: ReactNode; spots: Record<string, [Pt, Side]> };
type Seg = [Pt, Pt];

/** A shape drawn in model units (y up), fitted to the region: lines solid and hidden, ellipses, and where each
 *  dimension's label goes. */
function drawSolid(shape: SolidShape, d: Record<string, number>, dashed: boolean): Drawing {
  const lines: Seg[] = [], hidden: Seg[] = [], accent: Seg[] = [];
  const ellipses: { c: Pt; rx: number; ry: number; backDashed: boolean }[] = [];
  const at: Record<string, [Pt, Side]> = {};
  const P = (x: number, y: number, z = 0): Pt => ({ x: x + z * DEPTH.x, y: y + z * DEPTH.y * -1 });
  const box = (l: number, h: number, w: number) => {
    const c = [P(0, 0), P(l, 0), P(l, h), P(0, h), P(0, 0, w), P(l, 0, w), P(l, h, w), P(0, h, w)];
    [[0, 1], [1, 2], [2, 3], [3, 0], [1, 5], [5, 6], [6, 2], [3, 7], [7, 6]].forEach(([a, b]) => lines.push([c[a], c[b]]));
    [[0, 4], [4, 5], [4, 7]].forEach(([a, b]) => hidden.push([c[a], c[b]]));
    return c;
  };
  switch (shape) {
    case "sphere": {
      const r = d.r;
      ellipses.push({ c: P(0, 0), rx: r, ry: r, backDashed: false }, { c: P(0, 0), rx: r, ry: r * TILT, backDashed: true });
      accent.push([P(0, 0), P(r, 0)]);
      at.r = [P(r / 2, 0), "up"];
      break;
    }
    case "cube":
    case "box": {
      const [l, w, h] = shape === "cube" ? [d.side, d.side, d.side] : [d.length, d.width, d.height];
      const c = box(l, h, w);
      if (shape === "cube") {
        accent.push([c[0], c[1]]);
        at.side = [{ x: l / 2, y: 0 }, "down"];
      } else {
        accent.push([c[0], c[1]], [c[0], c[3]], [c[1], c[5]]);
        at.length = [{ x: l / 2, y: 0 }, "down"];
        at.height = [{ x: 0, y: h / 2 }, "left"];
        at.width = [{ x: (c[1].x + c[5].x) / 2, y: (c[1].y + c[5].y) / 2 }, "right"];
      }
      break;
    }
    case "cylinder":
    case "cone": {
      const { r, h } = d;
      ellipses.push({ c: P(0, 0), rx: r, ry: r * TILT, backDashed: true });
      if (shape === "cylinder") {
        ellipses.push({ c: P(0, h), rx: r, ry: r * TILT, backDashed: false });
        lines.push([P(-r, 0), P(-r, h)], [P(r, 0), P(r, h)]);
        accent.push([P(0, h), P(r, h)], [P(r, 0), P(r, h)]);
        at.r = [P(r / 2, h), "up"];
        at.h = [P(r, h / 2), "right"];
      } else {
        lines.push([P(-r, 0), P(0, h)], [P(r, 0), P(0, h)]);
        hidden.push([P(0, 0), P(0, h)]);
        accent.push([P(0, 0), P(r, 0)], [P(r, 0), P(0, h)]);
        at.r = [P(r / 2, 0), "up"];
        at.h = [P(0, h / 2), "left"];
        at.slant = [P(r / 2, h / 2), "right"];
      }
      break;
    }
    case "pyramid": {
      const { base: b, h } = d;
      const corners = [P(0, 0, 0), P(b, 0, 0), P(b, 0, b), P(0, 0, b)];
      const apex = P(b / 2, h, b / 2), front = P(b / 2, 0, 0), centre = P(b / 2, 0, b / 2);
      lines.push([corners[0], corners[1]], [corners[1], corners[2]], [corners[0], apex], [corners[1], apex], [corners[2], apex]);
      hidden.push([corners[2], corners[3]], [corners[3], corners[0]], [corners[3], apex], [centre, apex]);
      accent.push([corners[0], corners[1]], [front, apex]);
      at.base = [{ x: b / 2, y: 0 }, "down"];
      at.h = [{ x: (centre.x + apex.x) / 2, y: (centre.y + apex.y) / 2 }, "left"];
      at.slant = [{ x: (front.x + apex.x) / 2, y: (front.y + apex.y) / 2 }, "right"];
      break;
    }
  }
  // Fit every point (ellipses by their boxes) into the region, y flipped to the screen's.
  const pts: Pt[] = [...lines, ...hidden, ...accent].flat();
  for (const e of ellipses) pts.push({ x: e.c.x - e.rx, y: e.c.y - e.ry }, { x: e.c.x + e.rx, y: e.c.y + e.ry });
  const [x0, x1] = [Math.min(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.x))];
  const [y0, y1] = [Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.y))];
  const k = 0.78 * Math.min((REGION.x1 - REGION.x0) / Math.max(x1 - x0, 1e-9), (REGION.y1 - REGION.y0) / Math.max(y1 - y0, 1e-9));
  const ox = (REGION.x0 + REGION.x1) / 2 - ((x0 + x1) / 2) * k, oy = (REGION.y0 + REGION.y1) / 2 + ((y0 + y1) / 2) * k;
  const S = (p: Pt): Pt => ({ x: ox + p.x * k, y: oy - p.y * k });
  const dim = dashed ? { strokeDasharray: "4 4", opacity: 0.6 } : {};
  const seg = (s: Seg, i: number, style: Record<string, unknown>) => {
    const [a, b] = [S(s[0]), S(s[1])];
    return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...style} />;
  };
  const body = (
    <>
      {ellipses.map((e, i) => {
        const c = S(e.c), rx = e.rx * k, ry = e.ry * k;
        return e.backDashed ? (
          <g key={`e${i}`}>
            <path d={`M ${c.x - rx} ${c.y} A ${rx} ${ry} 0 0 1 ${c.x + rx} ${c.y}`} fill="none" stroke="var(--text-muted)" strokeWidth="1" strokeDasharray="3 3" />
            <path d={`M ${c.x - rx} ${c.y} A ${rx} ${ry} 0 0 0 ${c.x + rx} ${c.y}`} fill="none" stroke="var(--text-muted)" strokeWidth="1.5" {...dim} />
          </g>
        ) : <ellipse key={`e${i}`} cx={c.x} cy={c.y} rx={rx} ry={ry} fill="none" stroke="var(--text-muted)" strokeWidth="1.5" {...dim} />;
      })}
      {lines.map((s, i) => seg(s, i, { stroke: "var(--text-muted)", strokeWidth: 1.5, ...dim }))}
      {hidden.map((s, i) => seg(s, 1000 + i, { stroke: "var(--text-muted)", strokeWidth: 1, strokeDasharray: "3 3" }))}
      {accent.map((s, i) => seg(s, 2000 + i, { stroke: "var(--node-accent)", strokeWidth: 2.5 }))}
    </>
  );
  return { body, spots: Object.fromEntries(Object.entries(at).map(([key, [p, side]]) => [key, [S(p), side]])) };
}

/** The Solid card: a shape picker, the solid drawn in oblique projection with its dimensions keyable on it, and its
 *  other measures in the corner panel. A shape switch starts the card's own table afresh. */
export function SolidComponent({ data, emit }: NodeProps<SolidNode>) {
  const table = useKeyedTable(data, SOLID_DEFAULTS[data.op], "solids");
  const op = data.op;
  const shape = op;
  const solved = new Set(data.solvedByRow[table.row] ?? []);
  const { dims, panel } = LAYOUT[shape];
  const values = Object.fromEntries(dims.map((k) => [k, numAt(table.out, k, table.row)]));
  const known = dims.filter((k) => k !== "slant").every((k) => values[k] !== undefined && values[k]! > 0);
  const { body, spots } = drawSolid(shape, known ? (values as Record<string, number>) : STAND_IN[shape], !known);
  const text = (k: string) => { const v = values[k]; return shortText(table.keyedAt(k)) || (v === undefined ? "" : shortNum(v)); };
  const boxes = Object.fromEntries(dims.map((k) => [k, fieldBox(text(k))])) as Record<string, Box>;
  // Each label on its side of its line, clear of it, then any overlap pushed apart.
  const placed = separate(Object.fromEntries(dims.map((k) => {
    const [p, side] = spots[k] ?? [{ x: (REGION.x0 + REGION.x1) / 2, y: REGION.y1 }, "down"];
    const { w, h } = boxes[k];
    const off = { up: { x: 0, y: -(h / 2 + 4) }, down: { x: 0, y: h / 2 + 4 }, left: { x: -(w / 2 + 6), y: 0 }, right: { x: w / 2 + 6, y: 0 } }[side];
    return [k, { x: p.x + off.x, y: p.y + off.y }];
  })), boxes);
  const pick = (next: SolidShape) => {
    data.op = next;
    void table.replaceTable(SOLID_DEFAULTS[next]);
  };
  const aria = (k: string) => ({ r: "Radius", h: "Height", d: "Diameter" } as Record<string, string>)[k] ?? `${k[0].toUpperCase()}${k.slice(1)}`;

  return (
    <FigureCard data={data} emit={emit} table={table} valid={data.cachedValid}
      header={<OpSelect value={op} onChange={pick} options={SHAPE_OPTIONS} />}>
      <svg viewBox={`0 0 ${W} ${H}`} className="solenoid-geo__svg" aria-hidden="true">{body}</svg>
      {dims.map((k) => (
        <FigureField key={`${shape}:${k}:${table.row}`} name={k} at={placed[k]} keyed={table.keyedAt(k)} solved={values[k]}
          isSolved={solved.has(k)} editable={!table.wired} onCommit={(t) => void table.commitCells({ [k]: t })} ariaLabel={aria(k)} />
      ))}
      <div className="solenoid-geo__panel">
        {panel.map((k) => (
          <FigureField key={`${shape}:${k}:${table.row}`} name={k} keyed={table.keyedAt(k)} solved={numAt(table.out, k, table.row)}
            isSolved={solved.has(k)} editable={!table.wired} onCommit={(t) => void table.commitCells({ [k]: t })} ariaLabel={aria(k)} />
        ))}
      </div>
    </FigureCard>
  );
}
