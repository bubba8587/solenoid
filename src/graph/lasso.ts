// AutoCAD-style lasso geometry helpers — all operate in screen
// (container-relative) coords with Y-down.

import { createToggleStore } from "./storeKit";

export type Pt = { x: number; y: number };

/** True while a lasso / box-select drag is in flight. Canvas flips it on down/up; the
 *  HTML-canvas renderer reads it to switch to the cheap canvas layer during a lasso over
 *  many nodes (a lasso moves nothing, so the motion path wouldn't otherwise activate it). */
export const lassoActiveStore = createToggleStore();

// Signed area, in screen coords. Positive = the path winds CLOCKWISE
// visually (because screen Y is flipped from math Y). Used to decide
// the lasso mode: CW → "touch / crossing" (any overlap selects), CCW →
// "window / enclose" (must be fully inside to select).
export function signedArea(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s * 0.5;
}

// Ray-casting point-in-polygon. Handles arbitrary closed polygons.
export function pointInPolygon(p: Pt, pts: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y;
    const xj = pts[j].x, yj = pts[j].y;
    const intersect =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function segmentsIntersect(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-10) return false;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

// Test whether ANY edge of the lasso polygon crosses ANY edge of the
// 4-corner bounding box. Used for the CW "touch" mode where an overlap
// counts even if no corner is inside the lasso (e.g., the lasso is
// drawn inside the node).
export function polygonIntersectsBBox(poly: Pt[], corners: Pt[]): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    for (let j = 0; j < corners.length; j++) {
      const c = corners[j];
      const d = corners[(j + 1) % corners.length];
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}
