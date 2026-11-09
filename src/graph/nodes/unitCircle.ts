// [[C25]]

import { GraphNode } from "../graphModel";
import { nodeOnCore } from "../nodeOnCore";
import { frameOut, numListIn } from "./shared";
import type { SolError } from "../errorValue";
import type { FrameValue } from "../frame";
import { cardShapeOnCore, type Shape } from "../frameShape";

/** An angle's place on the unit circle, one row per angle: the wired angles, or the card's own off its dial. */
export class UnitCircleNode extends GraphNode {
  label: string;
  /** The angle reads its unit: radians, turns or gradians convert, and a bare number is degrees. */
  unitAware = true;
  literals: Record<string, number> = { angle: 30 };
  /** The row the figure shows, 0-based; view state. */
  row = 0;
  cachedResult: FrameValue | SolError | null = null;
  width = 340;
  height = 600;

  constructor(init?: { label?: string }) {
    super("UnitCircle");
    this.label = init?.label ?? "Unit Circle";
    this.addInput("angle", numListIn("Angle"));
    this.addOutput("circle", frameOut("Circle"));
  }

  frameShape(): Shape | null {
    return cardShapeOnCore(this, "circle", {});
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as Record<string, unknown>;
  }
}
