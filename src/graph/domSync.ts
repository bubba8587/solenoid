// [[C42]] htmlInCanvasRenderer
// Mechanics: [[html-in-canvas#Drawing and the camera]] (the DOM follows the presented camera).

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
