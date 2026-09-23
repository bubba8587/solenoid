// [[C85]] groupPushDeterministic, [[D63]] lockedGroupIsObstacle, [[C112]] noOverlapsEver
import { clamp } from "./nodes/mathUtils";

export interface PushBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ExpandSpec {
  x: number;
  y: number;
  preW: number;
  preH: number;
  postW: number;
  postH: number;
}

export interface Satellite {
  side: "upstream" | "downstream";
  alignCy: number;
}

export interface Disp {
  dx: number;
  dy: number;
}

export interface Pt {
  x: number;
  y: number;
}

const ANCHOR_DISP_WEIGHT = 0.5;

export const PUSH_GAP = 28;
const RAIL_STACK_GAP = 12;

const span = (a0: number, a1: number, b0: number, b1: number) =>
  Math.min(a1, b1) - Math.max(a0, b0);

interface Rect { x: number; y: number; w: number; h: number }

const xOverlap = (a: Rect, b: Rect) => span(a.x, a.x + a.w, b.x, b.x + b.w);
const yOverlap = (a: Rect, b: Rect) => span(a.y, a.y + a.h, b.y, b.y + b.h);
const rectsOverlap = (a: Rect, b: Rect) => xOverlap(a, b) > 0 && yOverlap(a, b) > 0;

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function overlappingPairs(boxes: readonly PushBox[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (rectsOverlap(boxes[i], boxes[j])) out.add(pairKey(boxes[i].id, boxes[j].id));
    }
  }
  return out;
}

export function computeExpandPush(
  spec: ExpandSpec,
  obstacles: PushBox[],
  satellites: Map<string, Satellite>,
  anchors: Map<string, Pt[]> = new Map(),
  fixed: ReadonlySet<string> = new Set(),
): Map<string, Disp> {
  const A: Rect = { x: spec.x, y: spec.y, w: spec.postW, h: spec.postH };
  const C: Rect = { x: spec.x, y: spec.y, w: spec.preW, h: spec.preH };
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

  const exempt = new Set(obstacles.filter((b) => fixed.has(b.id) || rectsOverlap(b, C)).map((b) => b.id));
  const baseline = overlappingPairs(obstacles);

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
    return { dx: 0, dy: 0 };
  };

  const railed = new Set<string>();
  for (const b of obstacles) {
    const sat = satellites.get(b.id);
    if (!sat || exempt.has(b.id)) continue;
    const s = clearShift(b);
    const collides = rectsOverlap(b, A);
    if (!s.dx && !s.dy && !collides) continue;
    if (sat.side === "downstream" && s.dx > 0) continue;
    const tx = sat.side === "upstream" ? A.x - PUSH_GAP - b.w : A.x + A.w + PUSH_GAP;
    const ty = clamp(sat.alignCy - b.h / 2, A.y, Math.max(A.y, A.y + A.h - b.h));
    disp.set(b.id, { dx: tx - b.x, dy: ty - b.y });
    railed.add(b.id);
  }
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

  for (const b of obstacles) {
    if (railed.has(b.id) || exempt.has(b.id)) continue;
    const s = clearShift(b);
    if (s.dx || s.dy) disp.set(b.id, s);
  }

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

export function separateOverlaps(
  boxes: PushBox[],
  gap = PUSH_GAP,
  pinned: Set<string> = new Set(),
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
    let worst: { a: PushBox; b: PushBox; ox: number; oy: number } | null = null;
    let worstArea = 0;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        if (pinned.has(boxes[i].id) && pinned.has(boxes[j].id)) continue;
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
    const ra = at(worst.a);
    const rb = at(worst.b);
    let mover: PushBox, other: PushBox;
    if (pinned.has(worst.a.id)) { mover = worst.b; other = worst.a; }
    else if (pinned.has(worst.b.id)) { mover = worst.a; other = worst.b; }
    else [mover, other] = ra.x + ra.y >= rb.x + rb.y ? [worst.a, worst.b] : [worst.b, worst.a];
    const m = at(mover);
    const o = at(other);
    const right = o.x + o.w + gap - m.x;
    const down = o.y + o.h + gap - m.y;
    if (right <= down) bump(mover.id, right, 0);
    else bump(mover.id, 0, down);
  }
  for (const [id, d] of [...disp]) if (d.dx === 0 && d.dy === 0) disp.delete(id);
  return disp;
}

export interface SeparateAllOpts {
  /** Boxes that move as one rigid unit (standoff clusters). */
  clusters?: ReadonlyArray<Iterable<string>>;
  /** Never move (position-locked groups). */
  fixed?: ReadonlySet<string>;
  /** Hold still while anything else can yield (what the op just placed). */
  prefer?: ReadonlySet<string>;
  gap?: number;
}

/** Afterwards no two boxes overlap, bar two fixed ones. */
export function separateAll(boxes: readonly PushBox[], opts: SeparateAllOpts = {}): Map<string, Disp> {
  const { fixed = new Set<string>(), prefer = new Set<string>(), gap = PUSH_GAP } = opts;
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const unitOf = new Map<string, string>();
  const unitMembers = new Map<string, string[]>();
  let ci = 0;
  for (const cl of opts.clusters ?? []) {
    const ids = [...cl].filter((id) => byId.has(id) && !unitOf.has(id));
    if (ids.length < 2) continue;
    const uid = `__cluster${ci++}`;
    for (const id of ids) unitOf.set(id, uid);
    unitMembers.set(uid, ids);
  }
  const units: PushBox[] = [];
  const fixedU = new Set<string>();
  const preferU = new Set<string>();
  for (const [uid, ids] of unitMembers) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of ids) {
      const b = byId.get(id)!;
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
      if (fixed.has(id)) fixedU.add(uid);
      if (prefer.has(id)) preferU.add(uid);
    }
    units.push({ id: uid, x: minX, y: minY, w: maxX - minX, h: maxY - minY });
  }
  for (const b of boxes) {
    if (unitOf.has(b.id)) continue;
    units.push({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h });
    if (fixed.has(b.id)) fixedU.add(b.id);
    if (prefer.has(b.id)) preferU.add(b.id);
  }
  const first = separateOverlaps(units, gap, new Set([...fixedU, ...preferU]));
  const shifted = units.map((u) => {
    const d = first.get(u.id);
    return d ? { ...u, x: u.x + d.dx, y: u.y + d.dy } : u;
  });
  const second = separateOverlaps(shifted, gap, fixedU);
  const out = new Map<string, Disp>();
  for (const u of units) {
    const a = first.get(u.id), b = second.get(u.id);
    const dx = (a?.dx ?? 0) + (b?.dx ?? 0);
    const dy = (a?.dy ?? 0) + (b?.dy ?? 0);
    if (dx === 0 && dy === 0) continue;
    for (const id of unitMembers.get(u.id) ?? [u.id]) out.set(id, { dx, dy });
  }
  return out;
}
