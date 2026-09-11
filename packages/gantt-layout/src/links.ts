// Dependency arrows: orthogonal polylines with the endpoint conventions FS right→left,
// SS left→left, FF right→right, SF left→right, an arrowhead, and (for the view) a wide
// invisible hit path drawn from the same points. Geometry ported from DHTMLX/SVAR link
// routers, rebuilt on serial-derived pixel anchors — no code copied.

import type { GanttPayload, GanttLink, LinkType } from "./payload";
import type { FrameRow, FrameBar, FrameScale, FrameLink } from "./frame";
import { xOf } from "./scale";

/** Horizontal stub length off a bar edge before the arrow turns, in px. */
const STUB = 11;

interface Anchor {
  left: number;
  right: number;
  midY: number;
  milestone: boolean;
}

/** Which edge each link end attaches to, and the arrow's pointing direction at the target. */
function ends(type: LinkType): { srcRight: boolean; tgtLeft: boolean } {
  switch (type) {
    case "FS": return { srcRight: true, tgtLeft: true };
    case "SS": return { srcRight: false, tgtLeft: true };
    case "FF": return { srcRight: true, tgtLeft: false };
    case "SF": return { srcRight: false, tgtLeft: false };
  }
}

export function buildLinks(
  payload: GanttPayload,
  rows: FrameRow[],
  _bars: FrameBar[],
  scale: FrameScale,
  _rowHeight: number,
  cull?: { top: number; height: number },
): FrameLink[] {
  if (payload.view.arrows === false) return [];

  // Anchor points for every task row (links must route even to a culled row's neighbor).
  const anchors = new Map<string, Anchor>();
  for (const row of rows) {
    if (row.section || row.taskIndex < 0) continue;
    const t = payload.tasks[row.taskIndex];
    const left = xOf(t.start, scale);
    const right = t.milestone ? xOf(t.start + 1, scale) : xOf(t.finish + 1, scale);
    const center = xOf(t.start + 0.5, scale);
    anchors.set(t.id, {
      left: t.milestone ? center : left,
      right: t.milestone ? center : right,
      midY: row.y + row.h / 2,
      milestone: t.milestone,
    });
  }

  const out: FrameLink[] = [];
  for (const link of payload.links) {
    const a = anchors.get(link.from);
    const b = anchors.get(link.to);
    if (!a || !b) continue; // an endpoint is collapsed/hidden — no arrow drawn

    if (cull) {
      const loY = Math.min(a.midY, b.midY);
      const hiY = Math.max(a.midY, b.midY);
      if (hiY < cull.top || loY > cull.top + cull.height) continue;
    }

    out.push(route(link, a, b));
  }
  return out;
}

function route(link: GanttLink, a: Anchor, b: Anchor): FrameLink {
  const { srcRight, tgtLeft } = ends(link.type);
  const sx = srcRight ? a.right : a.left;
  const sy = a.midY;
  const tx = tgtLeft ? b.left : b.right;
  const ty = b.midY;

  const sdir = srcRight ? 1 : -1;
  const tdir = tgtLeft ? 1 : -1; // arrow points +x into a left edge, -x into a right edge
  const exitX = sx + sdir * STUB;
  const entryX = tx - tdir * STUB;
  const midY = (sy + ty) / 2;

  // Six-point orthogonal route; collinear points are collapsed below. Handles forward links
  // and backward loops (entryX < exitX) alike.
  const raw = [
    { x: sx, y: sy },
    { x: exitX, y: sy },
    { x: exitX, y: midY },
    { x: entryX, y: midY },
    { x: entryX, y: ty },
    { x: tx, y: ty },
  ];
  const points = collapseCollinear(raw);

  return {
    from: link.from,
    to: link.to,
    type: link.type,
    critical: !!link.critical,
    violated: !!link.violated,
    points,
    arrow: { x: tx, y: ty, dir: tdir > 0 ? "right" : "left" },
  };
}

/** Drop the middle of any three collinear points so the polyline has no redundant vertices. */
function collapseCollinear(pts: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (const p of pts) {
    const n = out.length;
    if (n >= 2) {
      const a = out[n - 2];
      const b = out[n - 1];
      const abx = b.x - a.x, aby = b.y - a.y;
      const bcx = p.x - b.x, bcy = p.y - b.y;
      // collinear if the cross product is ~0 and same direction (both horizontal or vertical)
      if (Math.abs(abx * bcy - aby * bcx) < 1e-6) {
        out[n - 1] = p; // replace the middle point
        continue;
      }
    }
    out.push(p);
  }
  return out;
}
