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

export function cablePolyline(shape: CableShape, ends: CableEnds): { x: number; y: number }[] {
  const sourcePosition = ends.sourceFlipped ? Position.Left : Position.Right;
  const targetPosition = ends.targetFlipped ? Position.Right : Position.Left;
  const d = getCablePath(shape, {
    sourceX: intoSocket(ends.sx, sourcePosition),
    sourceY: ends.sy,
    sourcePosition,
    sourceAngleDeg: ends.sourceAngleDeg ?? null,
    targetX: intoSocket(ends.ex, targetPosition),
    targetY: ends.ey,
    targetPosition,
    targetAngleDeg: ends.targetAngleDeg ?? null,
  });
  return parsePathPoints(d);
}
