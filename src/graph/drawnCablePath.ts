// Free-drawn cable geometry: one `getCablePath` span per pair of points, chained. Pure.
import { getCablePath, Position } from "./cablePaths";
import type { CableShape } from "./cableShape";

export type DrawnPoint = {
  x: number;
  y: number;
  /** Heading override, degrees CW from +X (the drawers' units). Unset = derived chord. */
  angle?: number;
};

export type DrawnArrows = "none" | "start" | "end" | "both";

export const DRAWN_ARROWS: { value: DrawnArrows; label: string }[] = [
  { value: "none", label: "No arrowheads" },
  { value: "start", label: "Arrowhead at the start" },
  { value: "end", label: "Arrowhead at the end" },
  { value: "both", label: "Arrowheads at both ends" },
];

export function isDrawnArrows(v: unknown): v is DrawnArrows {
  return v === "none" || v === "start" || v === "end" || v === "both";
}

const DEG = 180 / Math.PI;
const TINY = 1e-6;

function headingOf(from: DrawnPoint, to: DrawnPoint): number | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.hypot(dx, dy) < TINY) return null;
  return Math.atan2(dy, dx) * DEG;
}

function unit(deg: number): { x: number; y: number } {
  const r = deg / DEG;
  return { x: Math.cos(r), y: Math.sin(r) };
}

export function hasAngleOverride(p: DrawnPoint): boolean {
  return typeof p.angle === "number" && Number.isFinite(p.angle);
}

/** Forward tangent heading at every point: the override if pinned, else the chord through
 *  the neighbours. Both spans at a point read the same value, so their end stubs are
 *  collinear and a joint never kinks. */
export function drawnHeadings(pts: readonly DrawnPoint[]): number[] {
  const n = pts.length;
  const out: number[] = new Array<number>(n).fill(0);
  if (n < 2) return out;
  for (let i = 0; i < n; i++) {
    if (hasAngleOverride(pts[i])) {
      out[i] = pts[i].angle as number;
      continue;
    }
    const prev = pts[i === 0 ? 0 : i - 1];
    const next = pts[i === n - 1 ? n - 1 : i + 1];
    const h =
      headingOf(prev, next) ??
      (i + 1 < n ? headingOf(pts[i], pts[i + 1]) : null) ??
      (i > 0 ? headingOf(pts[i - 1], pts[i]) : null);
    out[i] = h ?? (i > 0 ? out[i - 1] : 0);
  }
  return out;
}

/** The whole run as one `d`. With a head length, the stroke stops at each head's BASE
 *  rather than running under it to the tip, or a thick stroke shows through the
 *  triangle's sides and its round cap pokes out past the point. */
export function drawnCablePath(
  shape: CableShape,
  pts: readonly DrawnPoint[],
  arrows: DrawnArrows = "none",
  headLen = 0,
): string {
  const n = pts.length;
  if (n < 2) return "";
  const heads = drawnHeadings(pts);
  const ends: { x: number; y: number }[] = pts.map((p) => ({ x: p.x, y: p.y }));
  if (headLen > 0) {
    const span = (i: number) => Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    if (arrows === "start" || arrows === "both") {
      const u = unit(heads[0]);
      const d = Math.min(headLen, span(0) / 2);
      ends[0] = { x: pts[0].x + u.x * d, y: pts[0].y + u.y * d };
    }
    if (arrows === "end" || arrows === "both") {
      const u = unit(heads[n - 1]);
      const d = Math.min(headLen, span(n - 2) / 2);
      ends[n - 1] = { x: pts[n - 1].x - u.x * d, y: pts[n - 1].y - u.y * d };
    }
  }
  let d = "";
  for (let i = 0; i < n - 1; i++) {
    const seg = getCablePath(shape, {
      sourceX: ends[i].x,
      sourceY: ends[i].y,
      sourcePosition: Position.Right,
      sourceAngleDeg: heads[i],
      targetX: ends[i + 1].x,
      targetY: ends[i + 1].y,
      targetPosition: Position.Left,
      targetAngleDeg: heads[i + 1],
    });
    // One subpath: a second `M` would break the joins.
    d += i === 0 ? seg : ` L${seg.slice(1)}`;
  }
  return d;
}

// Shorter than the drawers' DIR_LEAD (14) so the directional end stub stays visible.
export const ARROW_LEN = 10;
export const ARROW_HALF = 4.6;

/** A filled triangle, tip at `tip`, pointing along `dirDeg`. */
export function arrowHeadPath(
  tip: DrawnPoint,
  dirDeg: number,
  len = ARROW_LEN,
  half = ARROW_HALF,
): string {
  const u = unit(dirDeg);
  const bx = tip.x - u.x * len;
  const by = tip.y - u.y * len;
  const px = -u.y * half;
  const py = u.x * half;
  return `M ${tip.x},${tip.y} L ${bx + px},${by + py} L ${bx - px},${by - py} Z`;
}

/** Tip and pointing direction of each head. The start head points back out of the run. */
export function drawnArrowHeads(
  pts: readonly DrawnPoint[],
  arrows: DrawnArrows,
): { tip: DrawnPoint; dirDeg: number }[] {
  if (arrows === "none" || pts.length < 2) return [];
  const heads = drawnHeadings(pts);
  const out: { tip: DrawnPoint; dirDeg: number }[] = [];
  if (arrows === "start" || arrows === "both") {
    out.push({ tip: pts[0], dirDeg: heads[0] + 180 });
  }
  if (arrows === "end" || arrows === "both") {
    out.push({ tip: pts[pts.length - 1], dirDeg: heads[heads.length - 1] });
  }
  return out;
}
