// Canvas cable hit-testing — pure geometry, the Phase-3 foundation. NOT WIRED IN.
//
// Phase 1 keeps an invisible per-cable hit <svg> in the DOM, which is what stops
// the canvas layer from fully clearing the compositing floor (each cable is still
// a DOM layer). Phase 3 replaces those with a single spatial hit-test against the
// canvas geometry. This module is that test, built standalone + unit-tested so it's
// ready when Phase 3 is greenlit — it has no DOM/React/store dependency and nothing
// imports it yet (no behaviour change).
//
// The cable path is an SVG `d` string (from `getCablePath`): M / L / C / Q commands,
// comma- OR space-separated (the walk router uses commas, one straight branch uses
// spaces). We flatten curves to a polyline once, then it's point→polyline distance.

export interface Pt { x: number; y: number }

// ── Path parsing → polyline ────────────────────────────────────────────────────

/** Tokenize an SVG path `d` into command letters and numbers. Handles comma or
 *  whitespace separators and signed decimals. Only M/L/C/Q/Z appear in our paths. */
function tokenize(d: string): Array<string | number> {
  const out: Array<string | number> = [];
  const re = /([MLCQZmlcqz])|(-?\d*\.?\d+(?:e[-+]?\d+)?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    if (m[1]) out.push(m[1]);
    else out.push(parseFloat(m[2]));
  }
  return out;
}

function cubicAt(t: number, p0: Pt, p1: Pt, p2: Pt, p3: Pt): Pt {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + e * p3.x, y: a * p0.y + b * p1.y + c * p2.y + e * p3.y };
}
function quadAt(t: number, p0: Pt, p1: Pt, p2: Pt): Pt {
  const u = 1 - t;
  const a = u * u, b = 2 * u * t, c = t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x, y: a * p0.y + b * p1.y + c * p2.y };
}

/** Flatten an SVG `d` (absolute M/L/C/Q only — what our cables emit) into a
 *  polyline. Curves are sampled into `curveSegs` segments each. Returns [] for an
 *  empty/garbage string. */
export function parsePathPoints(d: string, curveSegs = 18): Pt[] {
  const t = tokenize(d);
  const pts: Pt[] = [];
  let i = 0;
  let cur: Pt = { x: 0, y: 0 };
  const num = (): number => (typeof t[i] === "number" ? (t[i++] as number) : NaN);
  while (i < t.length) {
    const cmd = t[i] as string;
    if (typeof cmd !== "string") { i++; continue; } // stray number — skip
    i++;
    if (cmd === "M") {
      cur = { x: num(), y: num() };
      pts.push(cur);
    } else if (cmd === "L") {
      cur = { x: num(), y: num() };
      pts.push(cur);
    } else if (cmd === "C") {
      const p1 = { x: num(), y: num() };
      const p2 = { x: num(), y: num() };
      const p3 = { x: num(), y: num() };
      for (let s = 1; s <= curveSegs; s++) pts.push(cubicAt(s / curveSegs, cur, p1, p2, p3));
      cur = p3;
    } else if (cmd === "Q") {
      const p1 = { x: num(), y: num() };
      const p2 = { x: num(), y: num() };
      for (let s = 1; s <= curveSegs; s++) pts.push(quadAt(s / curveSegs, cur, p1, p2));
      cur = p2;
    } else if (cmd === "Z" || cmd === "z") {
      if (pts.length) pts.push(pts[0]);
    }
    // lowercase relative commands don't appear in our cables — ignored.
  }
  return pts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

// ── Distance ─────────────────────────────────────────────────────────────────

/** Distance from point p to segment a–b. */
export function pointSegmentDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Minimum distance from p to a polyline. Infinity for <2 points. */
export function pointPolylineDistance(p: Pt, pts: Pt[]): number {
  if (pts.length === 0) return Infinity;
  if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const d = pointSegmentDistance(p, pts[i - 1], pts[i]);
    if (d < best) best = d;
  }
  return best;
}

// ── Cable hit-test ─────────────────────────────────────────────────────────────

export interface CableGeom {
  id: string;
  /** Either the raw SVG `d` (flattened on the fly) or a pre-flattened polyline. */
  d?: string;
  points?: Pt[];
}

export interface CableHit { id: string; distance: number }

/** The nearest cable to `point` within `tolerance` (all in the SAME coordinate
 *  space — world or screen; the caller picks and converts tolerance accordingly),
 *  or null if none is within range. Ties resolve to the smallest distance, then to
 *  the earlier cable in the list (caller orders by z so the topmost wins). */
export function hitTestCables(point: Pt, cables: CableGeom[], tolerance: number): CableHit | null {
  let best: CableHit | null = null;
  for (const c of cables) {
    const pts = c.points ?? (c.d ? parsePathPoints(c.d) : []);
    const dist = pointPolylineDistance(point, pts);
    if (dist <= tolerance && (best === null || dist < best.distance)) {
      best = { id: c.id, distance: dist };
    }
  }
  return best;
}
