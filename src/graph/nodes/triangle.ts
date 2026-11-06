// [[C25]]

import { GraphNode } from "../graphModel";
import { nodeOnCore } from "../nodeOnCore";
import { frameIn, frameOut, logicalComboOut } from "./shared";
import type { SolError } from "../errorValue";
import type { FrameValue } from "../frame";
import { cardShapeOnCore, type Shape } from "../frameShape";
import type { FrameHint } from "../frameHint";

/** The keyed table a fresh card holds: one 3-4-5 triangle to solve (the core's `TRIANGLE_DEFAULT`). */
export const TRIANGLE_DEFAULT = '[{"name":"a","cells":["3"]},{"name":"b","cells":["4"]},{"name":"c","cells":["5"]},{"name":"A","cells":[""]},{"name":"B","cells":[""]},{"name":"C","cells":[""]},{"name":"area","cells":[""]},{"name":"perimeter","cells":[""]}]';

/** Solves one triangle per row of a frame: the wired frame, or the card's own keyed table when none is wired. */
export class TriangleSolverNode extends GraphNode {
  static frameHints: Record<string, FrameHint> = {
    triangles: { columns: [
      { name: "a", type: "number", cells: [3, 5, 7] },
      { name: "b", type: "number", cells: [4, 5, 9] },
      { name: "C", type: "number", cells: [90, 60, 40] },
    ] },
  };

  label: string;
  /** The keyed table, as Frame Input keeps its own (`frameText`). */
  frameText: string;
  /** The row the figure shows, 0-based; view state. */
  row = 0;
  cachedResult: FrameValue | SolError | null = null;
  cachedValid: boolean | SolError | null | (boolean | SolError | null)[] = null;
  /** For each row, the parts the solver worked out rather than read. */
  solvedByRow: string[][] = [];
  width = 340;
  height = 640;

  constructor(init?: { label?: string; frameText?: string }) {
    super("TriangleSolver");
    this.label = init?.label ?? "Triangle Solver";
    this.frameText = init?.frameText ?? TRIANGLE_DEFAULT;
    this.addInput("triangles", frameIn("Triangles"));
    this.addOutput("frame", frameOut("Triangles"));
    this.addOutput("valid", logicalComboOut("Valid"));
  }

  /** The eight columns, as the keyed table answers them; a wired frame's other columns ride along. */
  frameShape(): Shape | null {
    return cardShapeOnCore(this, "frame", {});
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as Record<string, unknown>;
  }
}
