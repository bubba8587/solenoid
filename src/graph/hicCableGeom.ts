// Cable geometry for the Pixi renderer — reuses the app's REAL router
// (`getCablePath` in cablePaths.ts) so GPU cables match the DOM cables exactly,
// then flattens the SVG path to a polyline (`parsePathPoints`) for Pixi to draw.
// Pure (no Pixi/DOM) → unit-testable.

import { getCablePath, Position } from "./cablePaths";
import type { CableShape } from "./cableShape";
import { parsePathPoints } from "./pathPoints";

export interface CableEnds {
  sx: number; sy: number;
  ex: number; ey: number;
  sourceAngleDeg?: number | null;
  targetAngleDeg?: number | null;
  /** A flipped endpoint's socket sits on the opposite edge (socketFlipStore): the stub
   *  then leaves/enters that side, exactly as FlowCableEdge routes the DOM cable. */
  sourceFlipped?: boolean;
  targetFlipped?: boolean;
}

/** World-space polyline for a cable between an output and an input socket, using the
 *  chosen shape. An output exits Right and an input enters Left unless its node is flipped. */
export function cablePolyline(shape: CableShape, ends: CableEnds): { x: number; y: number }[] {
  const d = getCablePath(shape, {
    sourceX: ends.sx,
    sourceY: ends.sy,
    sourcePosition: ends.sourceFlipped ? Position.Left : Position.Right,
    sourceAngleDeg: ends.sourceAngleDeg ?? null,
    targetX: ends.ex,
    targetY: ends.ey,
    targetPosition: ends.targetFlipped ? Position.Right : Position.Left,
    targetAngleDeg: ends.targetAngleDeg ?? null,
  });
  return parsePathPoints(d);
}
