import { parsePathPoints, type Pt } from "./cableHitTest";

// Cable geometry → GPU triangles. Pure + tested; the WebGL2 renderer uploads the
// output to a vertex buffer ONCE per geometry change, then pan/zoom only changes a
// transform uniform — no per-frame CPU re-tessellation.
//
// A cable is a flattened polyline (from the SVG `d` via parsePathPoints). We expand
// it into a triangle ribbon of the given width by offsetting each vertex along its
// MITER normal (the averaged normal of the two adjacent segments), so segments join
// without gaps. The miter length is capped (miterLimit) so a sharp corner bevels
// instead of shooting a spike — cables use rounded router corners, so this is rare.
// Output is independent triangles (6 verts/segment), NOT a strip, so many cables
// batch into ONE buffer + ONE draw with no degenerate stitching between them.

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
    // miter length factor: 1/cos(theta/2) = 1 / dot(miter, nIn). Guard the near-180°
    // fold (m ~ 0 → dot ~ 0) and cap to miterLimit.
    const cos = m.x * nIn.x + m.y * nIn.y;
    let scale = cos > 1e-4 ? 1 / cos : miterLimit;
    if (scale > miterLimit) scale = miterLimit;
    out[i] = { x: m.x * halfWidth * scale, y: m.y * halfWidth * scale };
  }
  return out;
}

/** Tessellate a polyline of `width` (full, world units) into triangle vertices,
 *  appended to `sink` as flat x,y pairs. Returns the number of VERTICES appended
 *  (6 per segment). <2 points → nothing. */
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
