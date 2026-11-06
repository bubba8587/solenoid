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
export const VERTICES_DEFAULT = '[{"name":"x","cells":["0","4","5","2","-1"]},{"name":"y","cells":["0","0","3","5","3"]}]';
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

/** The shapes the Solid card solves, in its picker's order. */
export const SOLID_SHAPES = ["sphere", "cube", "box", "cylinder", "cone", "pyramid"] as const;
export type SolidShape = (typeof SOLID_SHAPES)[number];

/** The one place each shape is named: the card's picker and its Add-menu rows read it. */
export const SOLID_OP_META = {
  sphere: { label: "Sphere", keywords: "ball volume surface" },
  cube: { label: "Cube", keywords: "volume surface diagonal" },
  box: { label: "Box", keywords: "cuboid rectangular prism volume surface diagonal" },
  cylinder: { label: "Cylinder", keywords: "volume lateral surface" },
  cone: { label: "Cone", keywords: "volume slant lateral surface" },
  pyramid: { label: "Square pyramid", keywords: "volume slant lateral surface" },
} satisfies Record<SolidShape, { label: string; keywords: string }>;

/** Each shape's keyed table on a fresh card or a shape switch (the core's `solid_of` defaults). */
export const SOLID_DEFAULTS: Record<SolidShape, string> = {
  cube: '[{"name":"side","cells":["3"]},{"name":"face diagonal","cells":[""]},{"name":"diagonal","cells":[""]},{"name":"volume","cells":[""]},{"name":"surface","cells":[""]}]',
  box: '[{"name":"length","cells":["4"]},{"name":"width","cells":["3"]},{"name":"height","cells":["2"]},{"name":"diagonal","cells":[""]},{"name":"volume","cells":[""]},{"name":"surface","cells":[""]}]',
  cylinder: '[{"name":"r","cells":["2"]},{"name":"h","cells":["5"]},{"name":"d","cells":[""]},{"name":"volume","cells":[""]},{"name":"lateral","cells":[""]},{"name":"surface","cells":[""]}]',
  cone: '[{"name":"r","cells":["3"]},{"name":"h","cells":["4"]},{"name":"d","cells":[""]},{"name":"slant","cells":[""]},{"name":"volume","cells":[""]},{"name":"lateral","cells":[""]},{"name":"surface","cells":[""]}]',
  pyramid: '[{"name":"base","cells":["4"]},{"name":"h","cells":["3"]},{"name":"slant","cells":[""]},{"name":"edge","cells":[""]},{"name":"volume","cells":[""]},{"name":"lateral","cells":[""]},{"name":"surface","cells":[""]}]',
  sphere: '[{"name":"r","cells":["3"]},{"name":"d","cells":[""]},{"name":"volume","cells":[""]},{"name":"surface","cells":[""]}]',
};

/** One solid of the card's shape per row: its dimensions and every measure, solved from any parts that fix them. */
export class SolidNode extends SolverFigureNode {
  op: SolidShape;

  constructor(init?: { label?: string; frameText?: string; op?: string }) {
    const op = (SOLID_SHAPES as readonly string[]).includes(init?.op ?? "") ? (init!.op as SolidShape) : "sphere";
    super("Solid", init, "Solid", SOLID_DEFAULTS[op], ["solids", "Solids"]);
    this.op = op;
  }
}

/** A polygon from its vertices in order, one per row: each vertex's edge and interior angle, and a summary row with
 *  the count, area, perimeter, centroid, convexity and winding. */
export class PolygonPointsNode extends GraphNode {
  label: string;
  frameText: string;
  row = 0;
  cachedResult: FrameValue | SolError | null = null;
  cachedPolygon: FrameValue | SolError | null = null;
  width = 340;
  height = 640;

  constructor(init?: { label?: string; frameText?: string }) {
    super("PolygonPoints");
    this.label = init?.label ?? "Polygon from Points";
    this.frameText = init?.frameText ?? VERTICES_DEFAULT;
    this.addInput("vertices", frameIn("Vertices"));
    this.addOutput("vertices", frameOut("Vertices"));
    this.addOutput("polygon", frameOut("Polygon"));
  }

  frameShape(outKey?: string): Shape | null {
    return cardShapeOnCore(this, outKey === "polygon" ? "polygon" : "vertices", {});
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as Record<string, unknown>;
  }
}
