// DOM↔canvas transform sync: during a gesture the viewport is steered to the camera
// the canvas actually PRESENTED, or DOM-only content skews a frame behind the paint.

export interface CamXform { k: number; x: number; y: number }

/** The viewport transform serialization (`translate(xpx, ypx) scale(k)`) — a sync
 *  write is a plain re-serialize of the live camera. */
export function holderTransform(t: CamXform): string {
  return `translate(${t.x}px, ${t.y}px) scale(${t.k})`;
}

/** The viewport transform that lands DOM-only content on the canvas's last-presented
 *  frame — null when they already agree, leaving the surface's own write untouched. */
export function holderSyncTransform(
  live: CamXform,
  presented: CamXform | null,
  eps = 0.01,
): string | null {
  if (!presented) return null;
  if (
    Math.abs(live.k - presented.k) < 1e-6 &&
    Math.abs(live.x - presented.x) < eps &&
    Math.abs(live.y - presented.y) < eps
  ) return null;
  return holderTransform(presented);
}

/** The 2-D affine parts of a DOMMatrix, structurally typed so this stays node-env
 *  testable. */
export interface Affine2D { a: number; b: number; c: number; d: number; e: number; f: number }

/** Recover the camera from the WICG draw matrix: for a capture box drawn at world
 *  (anchorX, anchorY) at natural size the matrix is translate(k·anchor + t) scale(k),
 *  so k = a and t = (e,f) − k·anchor. Null for anything the camera model can't
 *  represent, on which the caller keeps its own bookkeeping. */
export function camFromDrawMatrix(
  m: Affine2D,
  anchorX: number,
  anchorY: number,
  eps = 1e-4,
): CamXform | null {
  if (!Number.isFinite(m.a) || !Number.isFinite(m.e) || !Number.isFinite(m.f)) return null;
  if (Math.abs(m.b) > eps || Math.abs(m.c) > eps) return null; // rotation/skew
  if (Math.abs(m.a - m.d) > eps) return null; // non-uniform scale
  if (m.a <= eps) return null; // degenerate/mirrored
  return { k: m.a, x: m.e - m.a * anchorX, y: m.f - m.a * anchorY };
}

/** The WICG surface is experimental — a build could return backing-store px or an
 *  unexpected origin, so a native camera further than the tolerances is treated as a
 *  misparse and the bookkeeping wins. */
export function plausibleNativeCam(
  native: CamXform,
  book: CamXform,
  relTol = 0.02,
  pxTol = 4,
): boolean {
  if (Math.abs(native.k - book.k) > Math.abs(book.k) * relTol) return false;
  return Math.abs(native.x - book.x) <= pxTol && Math.abs(native.y - book.y) <= pxTol;
}
