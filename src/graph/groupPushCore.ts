// ─── Group expand push — pure geometry/topology core ──────────────────────────
// When a collapsed group expands it grows right/down from a fixed top-left
// (the collapsed card's corner). This module computes how the neighbourhood
// moves, on plain boxes — no rete, no DOM — so the rules are unit-testable.
//
// Rules, in order:
//  1. RAILS (connection-aware). A loose node wired to the group's members that
//     the expansion would displace doesn't get shoved geometrically — it lands
//     on its dataflow side: feeders on the LEFT edge, consumers on the RIGHT,
//     vertically aligned with the member(s) it connects to. A consumer already
//     right of the group keeps its clearance shift instead (it's on the
//     correct side — just clear it, don't re-place it).
//  2. CLEAR (minimal disturbance). ONLY boxes the expanded footprint would
//     actually cover move, and only just far enough to clear the expanded
//     edge plus a gap, along the axis matching where they sit relative to the
//     collapsed card (right of it → right, below → down, beyond both edges →
//     dominant axis from the card center). Free area is expanded into without
//     anything moving.
//  3. RESIDUAL. Belt-and-braces: anything still overlapping the expanded box
//     (rare body-crossing shapes) clears along the cheaper axis.
//  4. CASCADE. A moved box pushes anything it lands on (that it wasn't already
//     overlapping) just clear of itself, along its own direction of travel.
//     Movers are processed in original-position order and only push boxes that
//     started ahead of them, so a band of cleared boxes re-stacks in its
//     original order instead of flattening or inverting.
//
// Boxes that already overlapped the collapsed card were placed there by the
// user — expansion neither "fixes" nor displaces them (exempt).

import { clamp } from "./nodes/mathUtils";

export interface PushBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ExpandSpec {
  x: number;     // group top-left (fixed across the toggle)
  y: number;
  preW: number;  // collapsed card size (the seam origin)
  preH: number;
  postW: number; // expanded size
  postH: number;
}

export interface Satellite {
  side: "upstream" | "downstream";
  alignCy: number; // preferred center-y on the rail (connected members' mean)
}

export interface Disp {
  dx: number;
  dy: number;
}

export interface Pt {
  x: number;
  y: number;
}

// How much a longer hop must save in connection length to win over a shorter
// one when picking an anchor-aware clear direction.
const ANCHOR_DISP_WEIGHT = 0.5;

export const PUSH_GAP = 28;     // rail clearance from the expanded edge
const RAIL_STACK_GAP = 12;      // spacing between stacked rail satellites

const span = (a0: number, a1: number, b0: number, b1: number) =>
  Math.min(a1, b1) - Math.max(a0, b0);

interface Rect { x: number; y: number; w: number; h: number }

const xOverlap = (a: Rect, b: Rect) => span(a.x, a.x + a.w, b.x, b.x + b.w);
const yOverlap = (a: Rect, b: Rect) => span(a.y, a.y + a.h, b.y, b.y + b.h);
const rectsOverlap = (a: Rect, b: Rect) => xOverlap(a, b) > 0 && yOverlap(a, b) > 0;

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function computeExpandPush(
  spec: ExpandSpec,
  obstacles: PushBox[],
  satellites: Map<string, Satellite>,
  // Connection anchors per obstacle: where its cables to OTHER entities land.
  // A displaced box with anchors clears toward them (shortest connections win)
  // instead of blindly right/down. Satellites of the expanding group take
  // precedence (rails).
  anchors: Map<string, Pt[]> = new Map(),
): Map<string, Disp> {
  const A: Rect = { x: spec.x, y: spec.y, w: spec.postW, h: spec.postH }; // expanded
  const C: Rect = { x: spec.x, y: spec.y, w: spec.preW, h: spec.preH };   // collapsed card
  const dW = Math.max(0, spec.postW - spec.preW);
  const dH = Math.max(0, spec.postH - spec.preH);
  const disp = new Map<string, Disp>();
  if (dW === 0 && dH === 0) return disp;
  const seamX = spec.x + spec.preW;
  const seamY = spec.y + spec.preH;

  const byId = new Map(obstacles.map((b) => [b.id, b]));
  const moved = (b: PushBox): Rect => {
    const d = disp.get(b.id);
    return d ? { x: b.x + d.dx, y: b.y + d.dy, w: b.w, h: b.h } : b;
  };

  // User-made overlaps: exempt boxes sitting on the card; baseline pairs the
  // cascade must not try to separate.
  const exempt = new Set(obstacles.filter((b) => rectsOverlap(b, C)).map((b) => b.id));
  const baseline = new Set<string>();
  for (let i = 0; i < obstacles.length; i++) {
    for (let j = i + 1; j < obstacles.length; j++) {
      if (rectsOverlap(obstacles[i], obstacles[j])) {
        baseline.add(pairKey(obstacles[i].id, obstacles[j].id));
      }
    }
  }

  // How the expansion displaces this box: nothing unless the expanded
  // footprint would cover it; otherwise just far enough to clear the expanded
  // edge plus a gap. The direction:
  //  • with connection anchors — whichever of the four clears keeps its
  //    cables shortest (mean distance to anchors, plus a displacement penalty
  //    so a marginal cable saving doesn't justify a huge hop). A node wired
  //    to something on the LEFT hops left out of the way, not right.
  //  • without — the axis matching its position relative to the card (beside
  //    → right, under → down, beyond both edges → dominant axis).
  const clearShift = (b: PushBox): Disp => {
    if (!rectsOverlap(b, A)) return { dx: 0, dy: 0 };
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const clearRight = { dx: A.x + A.w + PUSH_GAP - b.x, dy: 0 };
    const clearDown = { dx: 0, dy: A.y + A.h + PUSH_GAP - b.y };
    const anch = anchors.get(b.id);
    if (anch && anch.length > 0) {
      const clearLeft = { dx: A.x - PUSH_GAP - b.w - b.x, dy: 0 };
      const clearUp = { dx: 0, dy: A.y - PUSH_GAP - b.h - b.y };
      let best: Disp = clearRight;
      let bestScore = Infinity;
      for (const d of [clearRight, clearDown, clearLeft, clearUp]) {
        const px = cx + d.dx;
        const py = cy + d.dy;
        let dist = 0;
        for (const a of anch) dist += Math.hypot(px - a.x, py - a.y);
        const score = dist / anch.length + ANCHOR_DISP_WEIGHT * Math.hypot(d.dx, d.dy);
        if (score < bestScore) {
          bestScore = score;
          best = d;
        }
      }
      return best;
    }
    const right = dW > 0 && cx >= seamX && yOverlap(b, A) > 0;
    const below = dH > 0 && cy >= seamY && xOverlap(b, A) > 0;
    if (right && below) {
      const horizontal = Math.abs(cx - (C.x + C.w / 2)) >= Math.abs(cy - (C.y + C.h / 2));
      return horizontal ? clearRight : clearDown;
    }
    if (right) return clearRight;
    if (below) return clearDown;
    return { dx: 0, dy: 0 }; // body-crosser with its center before both seams → residual
  };

  // ── 1. Rails ──────────────────────────────────────────────────────────────
  const railed = new Set<string>();
  for (const b of obstacles) {
    const sat = satellites.get(b.id);
    if (!sat || exempt.has(b.id)) continue;
    const s = clearShift(b);
    const collides = rectsOverlap(b, A);
    if (!s.dx && !s.dy && !collides) continue; // expansion doesn't touch it → leave it
    // A consumer already on its correct side (right of the group) keeps its
    // clearance shift — it just needs to get out of the way, not re-placed.
    if (sat.side === "downstream" && s.dx > 0) continue;
    const tx = sat.side === "upstream" ? A.x - PUSH_GAP - b.w : A.x + A.w + PUSH_GAP;
    const ty = clamp(sat.alignCy - b.h / 2, A.y, Math.max(A.y, A.y + A.h - b.h));
    disp.set(b.id, { dx: tx - b.x, dy: ty - b.y });
    railed.add(b.id);
  }
  // De-overlap each rail: stack downward in y order.
  for (const side of ["upstream", "downstream"] as const) {
    const rail = obstacles
      .filter((b) => railed.has(b.id) && satellites.get(b.id)!.side === side)
      .map((b) => ({ b, r: moved(b) }))
      .sort((p, q) => p.r.y - q.r.y);
    let cursor = -Infinity;
    for (const { b, r } of rail) {
      const y = Math.max(r.y, cursor);
      if (y !== r.y) {
        const d = disp.get(b.id)!;
        disp.set(b.id, { dx: d.dx, dy: d.dy + (y - r.y) });
      }
      cursor = y + r.h + RAIL_STACK_GAP;
    }
  }

  // ── 2. Clear ──────────────────────────────────────────────────────────────
  for (const b of obstacles) {
    if (railed.has(b.id) || exempt.has(b.id)) continue;
    const s = clearShift(b);
    if (s.dx || s.dy) disp.set(b.id, s);
  }

  // ── 3. Residual ───────────────────────────────────────────────────────────
  for (const b of obstacles) {
    if (exempt.has(b.id)) continue;
    const m = moved(b);
    if (!rectsOverlap(m, A)) continue;
    const right = A.x + A.w + PUSH_GAP - m.x;
    const down = A.y + A.h + PUSH_GAP - m.y;
    const d = disp.get(b.id) ?? { dx: 0, dy: 0 };
    if (right <= down) d.dx += right;
    else d.dy += down;
    disp.set(b.id, d);
  }

  // ── 4. Cascade ────────────────────────────────────────────────────────────
  // A mover pushes whatever it lands on just clear of itself, along its own
  // dominant direction of travel. It only pushes boxes that started AHEAD of
  // it along that direction — boxes that started behind get their turn as
  // movers — so a band of cleared boxes re-stacks in its original order
  // instead of flattening onto one line or inverting.
  const axisPos = (b: PushBox, horizontal: boolean) =>
    horizontal ? b.x + b.w / 2 : b.y + b.h / 2;
  const queue = [...disp.keys()].sort((a, b2) => {
    const ba = byId.get(a)!;
    const bb = byId.get(b2)!;
    return ba.x + ba.y - (bb.x + bb.y);
  });
  let guard = 0;
  while (queue.length && guard++ < 500) {
    const mid = queue.shift()!;
    const mBox = byId.get(mid);
    if (!mBox) continue;
    const M = moved(mBox);
    const d = disp.get(mid)!;
    const horizontal = Math.abs(d.dx) >= Math.abs(d.dy);
    const dir = Math.sign(horizontal ? d.dx : d.dy) || 1;
    for (const o of obstacles) {
      if (o.id === mid || exempt.has(o.id)) continue;
      if (baseline.has(pairKey(mid, o.id))) continue;
      if (!rectsOverlap(M, moved(o))) continue;
      // Original order decides who yields: only push boxes that started
      // ahead of the mover along its direction of travel.
      if ((axisPos(o, horizontal) - axisPos(mBox, horizontal)) * dir < 0) continue;
      const O = moved(o);
      const cur = disp.get(o.id) ?? { dx: 0, dy: 0 };
      let push = 0;
      if (horizontal) {
        push = dir > 0 ? M.x + M.w + PUSH_GAP - O.x : M.x - PUSH_GAP - (O.x + O.w);
        disp.set(o.id, { dx: cur.dx + push, dy: cur.dy });
      } else {
        push = dir > 0 ? M.y + M.h + PUSH_GAP - O.y : M.y - PUSH_GAP - (O.y + O.h);
        disp.set(o.id, { dx: cur.dx, dy: cur.dy + push });
      }
      if (push !== 0) queue.push(o.id);
    }
  }

  for (const [id, d] of [...disp]) {
    if (d.dx === 0 && d.dy === 0) disp.delete(id);
  }
  return disp;
}

// ─── Guaranteed de-overlap (safety net) ───────────────────────────────────────
// The heuristic expand pushes (rails / anchor-aware clears / cascade, composed
// across several groups) can still leave two boxes overlapping — even fully
// coincident — in awkward layouts. Overlap on expand is unacceptable, so this is
// the hard backstop: separate every overlapping pair by moving the more
// down-right box just clear along its cheaper axis. Moves are ALWAYS +x or +y, so
// boxes only ever shift down/right (the expand growth direction) — monotonic, so
// it always terminates (the guard is belt-and-braces). `baseline` pairKeys
// (pre-existing user overlaps) are left alone. Returns extra displacements to add.
export function separateOverlaps(
  boxes: PushBox[],
  baseline: Set<string> = new Set(),
  gap = PUSH_GAP,
): Map<string, Disp> {
  const disp = new Map<string, Disp>();
  const at = (b: PushBox): Rect => {
    const d = disp.get(b.id);
    return d ? { x: b.x + d.dx, y: b.y + d.dy, w: b.w, h: b.h } : b;
  };
  const bump = (id: string, dx: number, dy: number) => {
    const d = disp.get(id) ?? { dx: 0, dy: 0 };
    disp.set(id, { dx: d.dx + dx, dy: d.dy + dy });
  };
  let guard = 0;
  for (;;) {
    if (guard++ > 2000) break;
    // Worst (largest-area) non-baseline overlap.
    let worst: { a: PushBox; b: PushBox; ox: number; oy: number } | null = null;
    let worstArea = 0;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        if (baseline.has(pairKey(boxes[i].id, boxes[j].id))) continue;
        const a = at(boxes[i]);
        const b = at(boxes[j]);
        const ox = xOverlap(a, b);
        const oy = yOverlap(a, b);
        if (ox > 0 && oy > 0 && ox * oy > worstArea) {
          worstArea = ox * oy;
          worst = { a: boxes[i], b: boxes[j], ox, oy };
        }
      }
    }
    if (!worst) break;
    // Move the more down-right box (larger x+y of its CURRENT rect); the
    // top-left one stays put, preserving the anchor corner.
    const ra = at(worst.a);
    const rb = at(worst.b);
    const [mover, other] =
      ra.x + ra.y >= rb.x + rb.y ? [worst.a, worst.b] : [worst.b, worst.a];
    const m = at(mover);
    const o = at(other);
    // Cheaper positive (down/right) shift to clear: right vs down.
    const right = o.x + o.w + gap - m.x; // > 0 (they overlap)
    const down = o.y + o.h + gap - m.y;  // > 0
    if (right <= down) bump(mover.id, right, 0);
    else bump(mover.id, 0, down);
  }
  for (const [id, d] of [...disp]) if (d.dx === 0 && d.dy === 0) disp.delete(id);
  return disp;
}
