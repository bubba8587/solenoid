// Cable geometry for the Pixi renderer — reuses the app's REAL router
// (`getCablePath` in cablePaths.ts) so GPU cables match the DOM cables exactly,
// then flattens the SVG path to a polyline (`parsePathPoints`) for Pixi to draw.
// Pure (no Pixi/DOM) → unit-testable.

import { getCablePath, Position } from "../cablePaths";
import type { CableShape } from "../cableShape";
import { parsePathPoints } from "../cableHitTest";

export interface CableEnds {
  sx: number; sy: number;
  ex: number; ey: number;
  sourceAngleDeg?: number | null;
  targetAngleDeg?: number | null;
}

/** World-space polyline for a cable between an output (right) and input (left)
 *  socket, using the chosen shape. Defaults match the app's horizontal flow. */
export function cablePolyline(shape: CableShape, ends: CableEnds): { x: number; y: number }[] {
  const d = getCablePath(shape, {
    sourceX: ends.sx,
    sourceY: ends.sy,
    sourcePosition: Position.Right,
    sourceAngleDeg: ends.sourceAngleDeg ?? null,
    targetX: ends.ex,
    targetY: ends.ey,
    targetPosition: Position.Left,
    targetAngleDeg: ends.targetAngleDeg ?? null,
  });
  return parsePathPoints(d);
}
