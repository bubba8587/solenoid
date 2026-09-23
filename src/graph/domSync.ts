// [[C42]]
// Mechanics: tree/specs/canvas/html-in-canvas.md (The DOM follows the presented camera).

export interface CamXform { k: number; x: number; y: number }

export function holderTransform(t: CamXform): string {
  return `translate(${t.x}px, ${t.y}px) scale(${t.k})`;
}

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

export interface Affine2D { a: number; b: number; c: number; d: number; e: number; f: number }

export function camFromDrawMatrix(
  m: Affine2D,
  anchorX: number,
  anchorY: number,
  eps = 1e-4,
): CamXform | null {
  if (!Number.isFinite(m.a) || !Number.isFinite(m.e) || !Number.isFinite(m.f)) return null;
  if (Math.abs(m.b) > eps || Math.abs(m.c) > eps) return null;
  if (Math.abs(m.a - m.d) > eps) return null;
  if (m.a <= eps) return null;
  return { k: m.a, x: m.e - m.a * anchorX, y: m.f - m.a * anchorY };
}

export function plausibleNativeCam(
  native: CamXform,
  book: CamXform,
  relTol = 0.02,
  pxTol = 4,
): boolean {
  if (Math.abs(native.k - book.k) > Math.abs(book.k) * relTol) return false;
  return Math.abs(native.x - book.x) <= pxTol && Math.abs(native.y - book.y) <= pxTol;
}
