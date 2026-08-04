// Standoff constraint solver: pure iterative projection over plain boxes (no
// rete/DOM). Contradictory networks don't explode — iteration is bounded and
// the result is best-effort.

import { Standoff, Box, anchorPoint, ANCHOR_DIR } from "./standoffs";

export interface Disp {
  dx: number;
  dy: number;
}

const ITERATIONS = 48;
const EPSILON = 0.25;

export function solveStandoffs(
  boxes: Map<string, Box>,
  standoffs: readonly Standoff[],
  pinned: Set<string> = new Set(),
  opts: { forceLock?: boolean } = {},
): Map<string, Disp> {
  // forceLock treats EVERY standoff as rigid for this solve regardless of its
  // own `locked` flag, without mutating saved state.
  const forceLock = opts.forceLock === true;
  const disp = new Map<string, Disp>();
  if (standoffs.length === 0) return disp;

  const at = (id: string): Disp => {
    let d = disp.get(id);
    if (!d) {
      d = { dx: 0, dy: 0 };
      disp.set(id, d);
    }
    return d;
  };

  const active = standoffs.filter(
    (s) =>
      boxes.has(s.a.nodeId) &&
      boxes.has(s.b.nodeId) &&
      s.a.nodeId !== s.b.nodeId &&
      !(pinned.has(s.a.nodeId) && pinned.has(s.b.nodeId)),
  );
  if (active.length === 0) return disp;

  for (let i = 0; i < ITERATIONS; i++) {
    let worst = 0;
    for (const s of active) {
      const ba = boxes.get(s.a.nodeId)!;
      const bb = boxes.get(s.b.nodeId)!;
      const da = at(s.a.nodeId);
      const db = at(s.b.nodeId);
      const pa = anchorPoint({ ...ba, x: ba.x + da.dx, y: ba.y + da.dy }, s.a.anchor);
      const pb = anchorPoint({ ...bb, x: bb.x + db.dx, y: bb.y + db.dy }, s.b.anchor);
      const axis = ANCHOR_DIR[s.a.anchor];
      const aPinned = pinned.has(s.a.nodeId);
      const bPinned = pinned.has(s.b.nodeId);
      if (aPinned && bPinned) continue;
      const bShare = bPinned ? 0 : aPinned ? 1 : 0.5;

      // Axis term: clamp the projection onto the axis into [min, max].
      const t = (pb.x - pa.x) * axis.x + (pb.y - pa.y) * axis.y;
      const err = Math.min(Math.max(t, s.min), s.max) - t;
      if (Math.abs(err) > EPSILON) {
        worst = Math.max(worst, Math.abs(err));
        db.dx += axis.x * err * bShare;
        db.dy += axis.y * err * bShare;
        da.dx -= axis.x * err * (1 - bShare);
        da.dy -= axis.y * err * (1 - bShare);
      }

      // Perpendicular term (locked, or forced by a layout op).
      if (s.locked || forceLock) {
        const px = -axis.y;
        const py = axis.x;
        const tp = (pb.x - pa.x) * px + (pb.y - pa.y) * py;
        if (Math.abs(tp) > EPSILON) {
          worst = Math.max(worst, Math.abs(tp));
          const errp = -tp;
          db.dx += px * errp * bShare;
          db.dy += py * errp * bShare;
          da.dx -= px * errp * (1 - bShare);
          da.dy -= py * errp * (1 - bShare);
        }
      }
    }
    if (worst <= EPSILON) break;
  }

  for (const [id, d] of [...disp]) {
    if (Math.abs(d.dx) < EPSILON && Math.abs(d.dy) < EPSILON) disp.delete(id);
  }
  return disp;
}
