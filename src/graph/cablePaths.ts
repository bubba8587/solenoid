import type { CableShape } from "./cableShape";

// Cardinal direction enum used by socket-position math.
export enum Position {
  Left = "left",
  Right = "right",
  Top = "top",
  Bottom = "bottom",
}

type PathArgs = {
  sourceX: number;
  sourceY: number;
  sourcePosition: Position;
  // Exact exit angle in degrees (CW from +X). When supplied, the cable
  // leaves the socket along this direction in every shape mode (a rotated
  // Conduit sets it via cableAngleStore).
  sourceAngleDeg?: number | null;
  targetX: number;
  targetY: number;
  targetPosition: Position;
  targetAngleDeg?: number | null;
};

type Pt = { x: number; y: number };

// Below this Euclidean socket distance the cable is drawn as a literal
// straight line — the one allowed exception to every shape's routing rules.
// It is deliberately NOT a per-axis test: a target merely *aligned* with the
// source (directly below an east-facing arm, say) must still get a real
// route that exits the socket outward.
const STRAIGHT_THRESHOLD = 15;

const straightLine = (sx: number, sy: number, tx: number, ty: number) =>
  `M ${sx},${sy} L ${tx},${ty}`;

const toRad = (deg: number) => (deg * Math.PI) / 180;

function unitDeg(deg: number): Pt {
  const r = toRad(deg);
  return { x: Math.cos(r), y: Math.sin(r) };
}

// Exit unit vector for a cardinal Position (outward from that side).
function posExit(p: Position): Pt {
  switch (p) {
    case Position.Right:  return { x: 1, y: 0 };
    case Position.Left:   return { x: -1, y: 0 };
    case Position.Top:    return { x: 0, y: -1 };
    case Position.Bottom: return { x: 0, y: 1 };
    default:              return { x: 1, y: 0 };
  }
}

// Outward exit direction at the source / inward travel direction at the
// target: the angle hint when set, else the socket's cardinal side.
function exitDir(args: PathArgs): Pt {
  return args.sourceAngleDeg != null
    ? unitDeg(args.sourceAngleDeg)
    : posExit(args.sourcePosition);
}
function entryDir(args: PathArgs): Pt {
  if (args.targetAngleDeg != null) return unitDeg(args.targetAngleDeg);
  const out = posExit(args.targetPosition);
  return { x: -out.x, y: -out.y };
}

// ─── Spline (bezier) ──────────────────────────────────────────────────────────
// One tangent-exact cubic: the control arms sit along the exit / entry
// directions, so the curve leaves the source precisely along its exit
// direction and reaches the target precisely along its entry direction, and
// may start bending immediately after the socket — the "spacer" next to the
// socket is itself part of the bezier rather than a rigid straight lead.
function getAngleBezierPath(args: PathArgs): string {
  const dx = args.targetX - args.sourceX;
  const dy = args.targetY - args.sourceY;
  const dist = Math.hypot(dx, dy);
  if (dist < STRAIGHT_THRESHOLD) {
    return straightLine(args.sourceX, args.sourceY, args.targetX, args.targetY);
  }
  const dS = exitDir(args);
  const dT = entryDir(args);
  const arm = Math.max(40, dist * 0.4);
  const c1x = args.sourceX + dS.x * arm;
  const c1y = args.sourceY + dS.y * arm;
  const c2x = args.targetX - dT.x * arm;
  const c2y = args.targetY - dT.y * arm;
  return `M ${args.sourceX},${args.sourceY} C ${c1x},${c1y} ${c2x},${c2y} ${args.targetX},${args.targetY}`;
}

// ─── Compass-walk router (diagonal + straight modes) ──────────────────────────
// Both polyline shapes route through the same machinery, parametrised by how
// many compass headings exist: `div` = 8 for diagonal (segments on 45°
// multiples, turns of exactly ±45°) and 4 for straight (segments on 90°
// multiples, turns of exactly ±90°, rendered with rounded corners). The hard
// constraints hold by construction — there is no sharper-turn fallback:
//   • a rigid stub leaves the source along its exit direction and a rigid stub
//     arrives at the target along its entry direction (when the stub angle is
//     off the compass grid — rotated connector arms — the single stub junction
//     absorbs the difference, up to half a compass step);
//   • every other segment lies on a compass heading;
//   • consecutive segments turn by exactly one compass step or continue straight.
//
// A route is a WALK: the sequence of compass headings the cable visits, moving
// ±1 step between consecutive legs. The walk family is canonical — rotate
// backward `b` steps, forward `b + r + e` steps, backward `e` steps, where `r`
// is the step distance from exit heading to entry heading in rotation direction
// `sigma`. Candidates are tried in order of total turning and the FIRST solvable
// walk wins (never a cost comparison between rivals, which is what made earlier
// routers flicker: near-ties flip under 1px of drag). A walk that sweeps the
// full circle can absorb any displacement, so the search always terminates.
//
// Leg lengths come from a closed-form solve (see solveWalk). The solution is a
// continuous function of the endpoints for a fixed walk, and when a walk stops
// being solvable the next one's solution degenerates to exactly the shape the
// old one ended at — so dragging morphs the cable smoothly instead of snapping.
// The only true discontinuities left are the straight-line collapse for
// near-touching sockets and the over/under choice for head-on loops, both of
// which are inherent to the problem.

const DIR_LEAD = 14; // exit/entry stub — and the minimum visible staircase leg

// Nearest compass heading as an index, and the unit vector for an index.
// Indices are deliberately UNWRAPPED through the walk math (e.g. -3 or 9) so
// adjacency is plain integer succession; dirOfK wraps.
function compassIndex(d: Pt, div: number): number {
  const step = (2 * Math.PI) / div;
  return ((Math.round(Math.atan2(d.y, d.x) / step) % div) + div) % div;
}
function dirOfK(k: number, div: number): Pt {
  const a = (((k % div) + div) % div) * ((2 * Math.PI) / div);
  return { x: Math.cos(a), y: Math.sin(a) };
}

// Heading sequence for one canonical walk: kS →(−σ·b) →(+σ·(b+r+e)) →(−σ·e),
// ending at the entry heading kS + σ·r.
function buildHeads(kS: number, sigma: number, b: number, r: number, e: number): number[] {
  const heads = [kS];
  let h = kS;
  for (let i = 0; i < b; i++) heads.push(h -= sigma);
  for (let i = 0; i < b + r + e; i++) heads.push(h += sigma);
  for (let i = 0; i < e; i++) heads.push(h -= sigma);
  return heads;
}

const SOLVE_EPS = 0.01;

// Spread `amount` evenly over every leg with the given heading. Even split is
// what centers a Z's diagonal between its two straight runs.
function addToHeading(heads: number[], lens: number[], head: number, amount: number) {
  let n = 0;
  for (const h of heads) if (h === head) n++;
  for (let i = 0; i < heads.length; i++) if (heads[i] === head) lens[i] += amount / n;
}

// Solve leg lengths for a walk so the legs sum to the displacement D, or null
// if this walk can't reach D. Two kinds of legs:
//   • between two SAME-direction turns: gets at least minLeg — a staircase step
//     must be visible, and collapsing it would fuse two turns into a sharper one;
//   • between OPPOSITE turns (or adjoining a stub): may collapse to zero. Its
//     neighbors share a heading, so the collapse merges them into one straight
//     run — never a sharp corner. This is what lets adjacent walk shapes meet
//     continuously at their boundary.
// Exception to the second rule: a leg adjoining an OFF-GRID stub (a rotated
// connector arm whose exact angle isn't a compass heading) keeps minFirst /
// minLast. If it collapsed, the stub's snap offset and the first turn would
// merge into one corner sharper than a compass step (up to 135° in the
// orthogonal mode). Kept apart, the junction is a small snap turn (≤ half a
// step) followed by a clean full-step turn.
// The remaining displacement is decomposed on the unique adjacent pair of fan
// headings that brackets it (both coefficients ≥ 0 ⇔ it lies in their wedge)
// and spread across those headings' legs.
function solveWalk(
  heads: number[], D: Pt, minLeg: number, div: number,
  minFirst: number, minLast: number,
): number[] | null {
  const m = heads.length;
  const lens: number[] = new Array(m).fill(0);
  if (m > 1) {
    lens[0] = minFirst;
    lens[m - 1] = minLast;
  }
  for (let i = 1; i < m - 1; i++) {
    if (heads[i] - heads[i - 1] === heads[i + 1] - heads[i]) lens[i] = minLeg;
  }
  let rx = D.x, ry = D.y;
  for (let i = 0; i < m; i++) {
    if (lens[i] === 0) continue;
    const d = dirOfK(heads[i], div);
    rx -= d.x * lens[i];
    ry -= d.y * lens[i];
  }
  if (Math.hypot(rx, ry) < SOLVE_EPS) return lens;
  let lo = heads[0], hi = heads[0];
  for (const h of heads) { lo = Math.min(lo, h); hi = Math.max(hi, h); }
  if (lo === hi) {
    // Straight walk: solvable only when the residual lies along the heading.
    const d = dirOfK(lo, div);
    const along = rx * d.x + ry * d.y;
    if (Math.abs(rx * d.y - ry * d.x) > SOLVE_EPS || along < -SOLVE_EPS) return null;
    addToHeading(heads, lens, lo, Math.max(0, along));
    return lens;
  }
  const det = Math.sin((2 * Math.PI) / div); // cross of adjacent headings
  for (let j = lo; j < hi; j++) {
    const g = dirOfK(j + 1, div);
    const alpha = (rx * g.y - ry * g.x) / det;
    if (alpha < -SOLVE_EPS) continue;
    const f = dirOfK(j, div);
    const beta = (f.x * ry - f.y * rx) / det;
    if (beta < -SOLVE_EPS) continue;
    addToHeading(heads, lens, j, Math.max(0, alpha));
    addToHeading(heads, lens, j + 1, Math.max(0, beta));
    return lens;
  }
  return null;
}

function routeWalk(args: PathArgs, div: number): Pt[] {
  const S: Pt = { x: args.sourceX, y: args.sourceY };
  const T: Pt = { x: args.targetX, y: args.targetY };
  const dx = T.x - S.x, dy = T.y - S.y;
  const dist = Math.hypot(dx, dy);
  // Near-touching sockets: the one allowed exception — a literal straight line.
  if (dist < STRAIGHT_THRESHOLD) return [S, T];
  const dS = exitDir(args);
  const dT = entryDir(args);
  // Stubs and the staircase minimum shrink as the sockets close in, so the
  // route degrades gracefully toward the straight-line collapse instead of
  // knotting up at close range. The staircase minimum shrinks faster: a walk
  // through k same-direction turns consumes k·minLeg of displacement before
  // any slack is distributed, so at close range a large minimum can make every
  // walk unsolvable (the residual points backward out of every fan).
  const lead = Math.min(DIR_LEAD, dist / 4);
  const minLeg = Math.min(DIR_LEAD, dist / 8);
  const A: Pt = { x: S.x + dS.x * lead, y: S.y + dS.y * lead };
  const B: Pt = { x: T.x - dT.x * lead, y: T.y - dT.y * lead };
  const kS = compassIndex(dS, div);
  const kT = compassIndex(dT, div);
  // Off-grid stubs (rotated connector arms between compass headings) pin
  // their adjacent end leg open — see solveWalk.
  const gridS = dirOfK(kS, div);
  const gridT = dirOfK(kT, div);
  const offS = Math.abs(dS.x * gridS.y - dS.y * gridS.x) > 0.02;
  const offT = Math.abs(dT.x * gridT.y - dT.y * gridT.x) > 0.02;
  const D: Pt = { x: B.x - A.x, y: B.y - A.y };
  // Rotation-direction preference: which side of the exit/entry axes the far
  // socket sits on. Continuous in the endpoints, so it only flips at genuinely
  // ambiguous (collinear head-on) configurations.
  const pref = dS.x * dy - dS.y * dx + (dx * dT.y - dy * dT.x) >= 0 ? 1 : -1;
  const cands: { sigma: number; r: number; b: number; e: number; turns: number }[] = [];
  for (const sigma of [pref, -pref]) {
    const r = ((((kT - kS) * sigma) % div) + div) % div;
    for (let b = 0; b + r <= div; b++) {
      for (let e = 0; b + r + e <= div; e++) {
        cands.push({ sigma, r, b, e, turns: r + 2 * (b + e) });
      }
    }
  }
  // Stable sort: ties keep insertion order (preferred sigma first, then small b).
  cands.sort((p, q) => p.turns - q.turns);
  // If no walk solves at the full staircase minimum (only possible in cramped
  // configurations), halve it and retry: shrinking the minimum only enlarges
  // each walk's solvable set, so this terminates and the constraints still
  // hold — the steps just get smaller.
  for (let m = minLeg; m >= 0.25; m /= 2) {
    // Globally SHORTEST solvable walk; the sort order (fewest turns, then
    // preferred rotation) only settles exact length ties. Length must be the
    // primary criterion for continuity: when a walk enters feasibility it does
    // so at exactly the length of its own wider extension (its boundary
    // solution IS the extension's degenerate solution), and that extension was
    // already competing — so the handoff is seamless. Gating by turn count
    // first would bar the extension from winning and make the entry a visible
    // jump. With length primary, every selection switch is either seamless or
    // an equal-length swap between genuinely interchangeable routes (e.g.
    // mirror loops around a head-on target), which is inherent.
    let best: { heads: number[]; lens: number[]; total: number } | null = null;
    for (const c of cands) {
      const heads = buildHeads(kS, c.sigma, c.b, c.r, c.e);
      const lens = solveWalk(heads, D, m, div, offS ? m : 0, offT ? m : 0);
      if (!lens) continue;
      let total = 0;
      for (const l of lens) total += l;
      if (!best || total < best.total - SOLVE_EPS) best = { heads, lens, total };
    }
    if (!best) continue;
    const pts: Pt[] = [S, A];
    let px = A.x, py = A.y;
    for (let i = 0; i < best.heads.length; i++) {
      const d = dirOfK(best.heads[i], div);
      px += d.x * best.lens[i];
      py += d.y * best.lens[i];
      pts.push({ x: px, y: py });
    }
    pts.push(T);
    return pts;
  }
  return [S, T]; // unreachable in practice: tiny-step walks absorb anything
}

// ─── Polyline rendering ───────────────────────────────────────────────────────

// Collapsed walk legs produce exact duplicate points; drop those. The
// threshold must stay well under a pixel — a coarser one would delete real
// (tiny but on-grid) vertices and skew the headings of their neighbors.
const DEDUP_EPS = 0.01;

function ptsToPath(pts: Pt[]): string {
  const clean: Pt[] = [];
  for (const p of pts) {
    const last = clean[clean.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > DEDUP_EPS) clean.push(p);
  }
  return clean.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x},${p.y}`).join(" ");
}

const CORNER_RADIUS = 8;

// Rounded-corner rendering for the straight (orthogonal) shape: duplicate
// points and collinear runs are merged, then every remaining corner becomes a
// quadratic round whose radius caps at half the shorter adjacent leg, so
// rounds can never overlap.
function roundedPtsToPath(pts: Pt[], radius: number): string {
  const clean: Pt[] = [];
  for (const p of pts) {
    const last = clean[clean.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) <= DEDUP_EPS) continue;
    while (clean.length >= 2) {
      const a = clean[clean.length - 2];
      const b = clean[clean.length - 1];
      const ux = b.x - a.x, uy = b.y - a.y;
      const vx = p.x - b.x, vy = p.y - b.y;
      const sinTurn = (ux * vy - uy * vx) / (Math.hypot(ux, uy) * Math.hypot(vx, vy));
      if (Math.abs(sinTurn) > 0.005 || ux * vx + uy * vy < 0) break;
      clean.pop(); // b sits on a straight run — drop it
    }
    clean.push(p);
  }
  if (clean.length < 2) return clean.length ? `M ${clean[0].x},${clean[0].y}` : "";
  let d = `M ${clean[0].x},${clean[0].y}`;
  for (let i = 1; i < clean.length - 1; i++) {
    const a = clean[i - 1], v = clean[i], b = clean[i + 1];
    const la = Math.hypot(v.x - a.x, v.y - a.y);
    const lb = Math.hypot(b.x - v.x, b.y - v.y);
    const r = Math.min(radius, la / 2, lb / 2);
    const inX = v.x - ((v.x - a.x) / la) * r;
    const inY = v.y - ((v.y - a.y) / la) * r;
    const outX = v.x + ((b.x - v.x) / lb) * r;
    const outY = v.y + ((b.y - v.y) / lb) * r;
    d += ` L ${inX},${inY} Q ${v.x},${v.y} ${outX},${outY}`;
  }
  const end = clean[clean.length - 1];
  return d + ` L ${end.x},${end.y}`;
}

export function getCablePath(shape: CableShape, args: PathArgs): string {
  switch (shape) {
    case "straight":
      return roundedPtsToPath(routeWalk(args, 4), CORNER_RADIUS);
    case "diagonal":
      return ptsToPath(routeWalk(args, 8));
    case "spline":
    default:
      return getAngleBezierPath(args);
  }
}
