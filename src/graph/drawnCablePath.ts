// Path geometry for FREE-DRAWN cables: a point-by-point polyline rendered through
// the SAME three drawers a wired cable uses (`getCablePath`), one call per span.
// Pure — no rete, no DOM, no store — so `drawnCablePath.test.ts` can drive it.
import { getCablePath, Position } from "./cablePaths";
import type { CableShape } from "./cableShape";

export type DrawnPoint = { x: number; y: number };

/** Which ends carry a head. */
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

/** Forward tangent heading (degrees CW from +X) at every point.
 *
 *  An interior point takes the CHORD THROUGH ITS NEIGHBOURS, so the span arriving and
 *  the span leaving are handed the same direction: each drawer pins its end stub to
 *  exactly that heading, so the two stubs are collinear and the joint reads as one
 *  continuous cable instead of a kink. Coincident neighbours fall back to whichever
 *  adjacent span still has length. */
export function drawnHeadings(pts: readonly DrawnPoint[]): number[] {
  const n = pts.length;
  const out: number[] = new Array<number>(n).fill(0);
  if (n < 2) return out;
  for (let i = 0; i < n; i++) {
    const prev = pts[i === 0 ? 0 : i - 1];
    const next = pts[i === n - 1 ? n - 1 : i + 1];
    const h =
      headingOf(prev, next) ??
      (i + 1 < n ? headingOf(pts[i], pts[i + 1]) : null) ??
      (i > 0 ? headingOf(pts[i - 1], pts[i]) : null);
    // Every point coincides: any heading draws the same degenerate dot.
    out[i] = h ?? (i > 0 ? out[i - 1] : 0);
  }
  return out;
}

/** The whole run as ONE `d`. Fewer than two points draws nothing. */
export function drawnCablePath(shape: CableShape, pts: readonly DrawnPoint[]): string {
  if (pts.length < 2) return "";
  const heads = drawnHeadings(pts);
  let d = "";
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = getCablePath(shape, {
      sourceX: pts[i].x,
      sourceY: pts[i].y,
      sourcePosition: Position.Right,
      sourceAngleDeg: heads[i],
      targetX: pts[i + 1].x,
      targetY: pts[i + 1].y,
      targetPosition: Position.Left,
      targetAngleDeg: heads[i + 1],
    });
    // Every drawer emits `M x,y …`. After the first span the move becomes a LINE to
    // the shared point (zero length — the spans already meet there), keeping the run
    // a single subpath so joins render and a head sits on a real path end.
    d += i === 0 ? seg : ` L${seg.slice(1)}`;
  }
  return d;
}

// The head at scale 1. Deliberately shorter than the routers' end stub (DIR_LEAD = 14):
// in straight and diagonal mode that stub IS the visible directional lead, and a head
// as long as it hides the lead, leaving the arrow looking bolted on at an angle to the
// last leg. A scale above ~1.4 trades that lead away, which is the author's call to make.
export const ARROW_LEN = 10;
export const ARROW_HALF = 4.6;

/** A filled triangle whose TIP is at `tip`, opening back along `dirDeg` — the
 *  direction the head points. */
export function arrowHeadPath(
  tip: DrawnPoint,
  dirDeg: number,
  len = ARROW_LEN,
  half = ARROW_HALF,
): string {
  const r = dirDeg / DEG;
  const ux = Math.cos(r);
  const uy = Math.sin(r);
  const bx = tip.x - ux * len;
  const by = tip.y - uy * len;
  const px = -uy * half;
  const py = ux * half;
  return `M ${tip.x},${tip.y} L ${bx + px},${by + py} L ${bx - px},${by - py} Z`;
}

/** Tip + pointing direction for each head the setting asks for. The START head points
 *  BACKWARD out of the first point (a two-headed cable reads both ways). */
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
