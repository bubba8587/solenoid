// DOM↔canvas transform sync for the HTML-in-Canvas renderer. During a gesture the
// canvas draws the graph while DOM-only content (conduits, their cables, the standoff
// svg) stays live DOM inside rete's holder — two presentation pipelines that can skew
// by a frame or more (the "conduit trails the pan" complaint): the canvas presents the
// camera it PAINTED with, the holder composites rete's freshest CSS transform.
//
// The fix: while gesturing, steer the holder's transform to the camera the canvas
// actually presented (holderSyncTransform), and derive that presented camera from the
// WICG API itself when the build exposes it — drawElementImage returns (and
// getElementTransform computes) the CSS matrix that puts an element exactly where the
// canvas drew it, browser-side rounding included (camFromDrawMatrix).
//
// Pure math (no DOM) → domSync.test.ts.

export interface CamXform { k: number; x: number; y: number }

/** rete-area-plugin's exact holder transform serialization (Area.update → holder
 *  style.transform, transformOrigin '0 0'). Byte-identical so our sync write is
 *  indistinguishable from rete's own, and restoring is a plain re-serialize. */
export function holderTransform(t: CamXform): string {
  return `translate(${t.x}px, ${t.y}px) scale(${t.k})`;
}

/**
 * The transform the holder should show so DOM-only content lands exactly on the
 * canvas's last-presented frame — or null when live and presented already agree
 * (leave rete's own write untouched; null is also the answer with nothing
 * presented yet). `eps` is in CSS px — sub-1/100-px skew isn't visible.
 */
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

/** The 2-D affine components of a DOMMatrix we care about (structural, so the
 *  pure math never touches the DOM type — node-env testable). */
export interface Affine2D { a: number; b: number; c: number; d: number; e: number; f: number }

/**
 * Recover the camera from the CSS sync matrix the WICG API hands back for a drawn
 * element (drawElementImage's return / getElementTransform). For an element whose
 * capture box was drawn at world (anchorX, anchorY) with dw==natural w (our case:
 * REF=1, dest size == padded box), the matrix is translate(k·anchor + t) scale(k),
 * so k = a and t = (e,f) − k·anchor. Returns null for anything the camera model
 * can't represent (rotation/skew/non-uniform scale) or a degenerate scale —
 * caller falls back to its own bookkeeping.
 */
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

/**
 * Is a native-derived camera close enough to our bookkeeping to trust? The WICG
 * surface is experimental — a build could hand back a matrix in backing-store px
 * or with an unexpected origin. Within `relTol` of the bookkeeping scale and
 * `pxTol` CSS px of its translation = the same frame, browser rounding included;
 * anything further = misparse, keep the bookkeeping.
 */
export function plausibleNativeCam(
  native: CamXform,
  book: CamXform,
  relTol = 0.02,
  pxTol = 4,
): boolean {
  if (Math.abs(native.k - book.k) > Math.abs(book.k) * relTol) return false;
  return Math.abs(native.x - book.x) <= pxTol && Math.abs(native.y - book.y) <= pxTol;
}
