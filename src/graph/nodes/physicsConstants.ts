// [[C76]] formulaPackDefault, [[C25]] firstClassUnits

import { GraphNode } from "../graphModel";
import { nodeOnCore } from "../nodeOnCore";
import { numOut } from "./shared";
import type { FormatAnnotation } from "../formatAnnotationStore";
import { PHYS_CONSTANTS, type PhysConstOp } from "./physicsConstantsOps";

export class PhysicsConstantNode extends GraphNode {
  label: string;
  op: PhysConstOp;
  width = 240;
  height = 110;

  constructor(init?: { label?: string; op?: PhysConstOp }) {
    super("PhysicsConstant");
    this.op = init?.op ?? "c";
    this.label = init?.label ?? "";
    this.addOutput("value", numOut("Value"));
  }

  data(inputs: Record<string, unknown[] | undefined> = {}) {
    return nodeOnCore(this, inputs) as { value: number };
  }

  /** A custom suffix, because units like J·s are not Format Controller unit ids. */
  annotation(): FormatAnnotation {
    return { format: "auto", unit: "custom", customUnit: ` ${PHYS_CONSTANTS[this.op].unit}` };
  }
}
