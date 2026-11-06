// [[C25]]

import { GraphNode } from "../graphModel";
import { nodeOnCore } from "../nodeOnCore";
import { frameIn, frameOut, logicalComboOut } from "./shared";
import type { SolError } from "../errorValue";
import type { FrameValue } from "../frame";
import { cardShapeOnCore, type Shape } from "../frameShape";

/** The keyed tables fresh cards hold (the core's `CIRCLE_DEFAULT`, `POLYGON_DEFAULT`, `POINTS_DEFAULT`). */
export const CIRCLE_DEFAULT = '[{"name":"r","cells":["5"]},{"name":"d","cells":[""]},{"name":"circumference","cells":[""]},{"name":"area","cells":[""]},{"name":"angle","cells":["60"]},{"name":"arc","cells":[""]},{"name":"chord","cells":[""]},{"name":"sector","cells":[""]},{"name":"segment","cells":[""]},{"name":"height","cells":[""]}]';
export const POLYGON_DEFAULT = '[{"name":"n","cells":["6"]},{"name":"side","cells":["4"]},{"name":"circumradius","cells":[""]},{"name":"apothem","cells":[""]},{"name":"perimeter","cells":[""]},{"name":"area","cells":[""]},{"name":"interior","cells":[""]},{"name":"exterior","cells":[""]}]';
export const POINTS_DEFAULT = '[{"name":"x1","cells":["1"]},{"name":"y1","cells":["2"]},{"name":"x2","cells":["5"]},{"name":"y2","cells":["5"]}]';

/** A geometry figure card: one figure per row of a frame, the wired one or its own keyed table, answered as the same
 *  frame with every part filled. A solver also answers Valid per row and which parts each row solved. */
abstract class FigureNode extends GraphNode {
  label: string;
  /** The keyed table, as Frame Input keeps its own (`frameText`). */
  frameText: string;
  /** The row the figure shows, 0-based; view state. */
  row = 0;
  cachedResult: FrameValue | SolError | null = null;
  width = 340;
  height = 640;

  constructor(kind: string, init: { label?: string; frameText?: string } | undefined, label: string, frameText: string, input: [string, string]) {
    super(kind);
    this.label = init?.label ?? label;
    this.frameText = init?.frameText ?? frameText;
    this.addInput(input[0], frameIn(input[1]));
    this.addOutput("frame", frameOut(input[1]));
  }

  frameShape(): Shape | null {
    return cardShapeOnCore(this, "frame", {});
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as Record<string, unknown>;
  }
}

/** A figure that solves: Valid per row, and the parts each row worked out rather than read. */
abstract class SolverFigureNode extends FigureNode {
  cachedValid: boolean | SolError | null | (boolean | SolError | null)[] = null;
  solvedByRow: string[][] = [];

  constructor(kind: string, init: { label?: string; frameText?: string } | undefined, label: string, frameText: string, input: [string, string]) {
    super(kind, init, label, frameText, input);
    this.addOutput("valid", logicalComboOut("Valid"));
  }
}

/** A circle and an arc of it per row: radius, diameter, circumference, area, the central angle, and the arc's length,
 *  chord, sector, segment and height, solved from any parts that fix them. */
export class CircleSolverNode extends SolverFigureNode {
  constructor(init?: { label?: string; frameText?: string }) {
    super("CircleSolver", init, "Circle Solver", CIRCLE_DEFAULT, ["circles", "Circles"]);
  }
}

/** A regular polygon per row: side count, side, circumradius, apothem, perimeter, area and its angles. */
export class RegularPolygonNode extends SolverFigureNode {
  constructor(init?: { label?: string; frameText?: string }) {
    super("RegularPolygon", init, "Regular Polygon", POLYGON_DEFAULT, ["polygons", "Polygons"]);
  }
}

/** Two points per row and the line through them: distance, run and rise, midpoint, slope, direction, intercepts and
 *  the equation. */
export class TwoPointsNode extends FigureNode {
  constructor(init?: { label?: string; frameText?: string }) {
    super("TwoPoints", init, "Two Points", POINTS_DEFAULT, ["points", "Points"]);
  }
}
