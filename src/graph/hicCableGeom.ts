// [[C42]] htmlInCanvasRenderer

import { getCablePath, intoSocket, Position } from "./cablePaths";
import type { CableShape } from "./cableShape";
import { parsePathPoints } from "./pathPoints";

export interface CableEnds {
  sx: number; sy: number;
  ex: number; ey: number;
  sourceAngleDeg?: number | null;
  targetAngleDeg?: number | null;
  sourceFlipped?: boolean;
  targetFlipped?: boolean;
}

/** The router's own SVG path, the one the DOM cable draws, in world coordinates. */
export function cablePathD(shape: CableShape, ends: CableEnds): string {
  const sourcePosition = ends.sourceFlipped ? Position.Left : Position.Right;
  const targetPosition = ends.targetFlipped ? Position.Right : Position.Left;
  return getCablePath(shape, {
    sourceX: intoSocket(ends.sx, sourcePosition),
    sourceY: ends.sy,
    sourcePosition,
    sourceAngleDeg: ends.sourceAngleDeg ?? null,
    targetX: intoSocket(ends.ex, targetPosition),
    targetY: ends.ey,
    targetPosition,
    targetAngleDeg: ends.targetAngleDeg ?? null,
  });
}

/** The path flattened, for bounds; drawing strokes `cablePathD` itself, so curves stay exact at any zoom. */
export function cablePolyline(shape: CableShape, ends: CableEnds): { x: number; y: number }[] {
  return parsePathPoints(cablePathD(shape, ends));
}
