import { parsePathPoints, type Pt } from "./cableHitTest";

// Polyline → triangle ribbon by offsetting each vertex along its MITER normal, capped at
// miterLimit so a sharp corner bevels instead of shooting a spike. Output is independent
// triangles, NOT a strip, so many cables batch into ONE buffer and ONE draw.

const perp = (dx: number, dy: number): Pt => ({ x: -dy, y: dx });
function norm(p: Pt): Pt {
  const len = Math.hypot(p.x, p.y);
  return len === 0 ? { x: 0, y: 0 } : { x: p.x / len, y: p.y / len };
}

/** Per-vertex outward offset (half-width × miter normal) for a polyline. Length n. */
export function miterOffsets(pts: Pt[], halfWidth: number, miterLimit = 4): Pt[] {
  const n = pts.length;
  const out: Pt[] = new Array(n);
  if (n === 0) return out;
  if (n === 1) { out[0] = { x: 0, y: 0 }; return out; }

  // Segment unit normals (n-1 of them).
  const segN: Pt[] = [];
  for (let i = 0; i < n - 1; i++) {
    const d = norm({ x: pts[i + 1].x - pts[i].x, y: pts[i + 1].y - pts[i].y });
    segN.push(norm(perp(d.x, d.y)));
  }

  for (let i = 0; i < n; i++) {
    const nIn = segN[i - 1];   // undefined at i=0
    const nOut = segN[i];      // undefined at i=n-1
    if (!nIn) { out[i] = { x: nOut.x * halfWidth, y: nOut.y * halfWidth }; continue; }
    if (!nOut) { out[i] = { x: nIn.x * halfWidth, y: nIn.y * halfWidth }; continue; }
    const m = norm({ x: nIn.x + nOut.x, y: nIn.y + nOut.y });
    // 1/cos(theta/2) = 1 / dot(miter, nIn); guard the near-180° fold and cap to miterLimit.
    const cos = m.x * nIn.x + m.y * nIn.y;
    let scale = cos > 1e-4 ? 1 / cos : miterLimit;
    if (scale > miterLimit) scale = miterLimit;
    out[i] = { x: m.x * halfWidth * scale, y: m.y * halfWidth * scale };
  }
  return out;
}

/** Append a polyline of `width` (world units) to `sink` as flat x,y pairs; returns the
 *  VERTEX count (6 per segment), 0 for fewer than 2 points. */
export function tessellatePolyline(pts: Pt[], width: number, sink: number[]): number {
  if (pts.length < 2) return 0;
  const off = miterOffsets(pts, width / 2);
  let added = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const oa = off[i], ob = off[i + 1];
    // Quad corners: a±oa, b±ob. Two triangles (A,B,C) (B,D,C).
    const Ax = a.x + oa.x, Ay = a.y + oa.y;
    const Bx = a.x - oa.x, By = a.y - oa.y;
    const Cx = b.x + ob.x, Cy = b.y + ob.y;
    const Dx = b.x - ob.x, Dy = b.y - ob.y;
    sink.push(Ax, Ay, Bx, By, Cx, Cy,  Bx, By, Dx, Dy, Cx, Cy);
    added += 6;
  }
  return added;
}

/** Convenience: flatten an SVG cable `d` and tessellate it. Returns vertex count. */
export function tessellateCablePath(d: string, width: number, sink: number[]): number {
  return tessellatePolyline(parsePathPoints(d), width, sink);
}
