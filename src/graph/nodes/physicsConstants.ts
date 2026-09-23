// [[C76]] formulaPackDefault, [[D40]] unitOnValue

import { ClassicPreset } from "rete";
import { numOut } from "./shared";
import type { FormatAnnotation } from "../formatAnnotationStore";
import { PHYS_CONSTANTS, type PhysConstOp } from "./physicsConstantsOps";

export class PhysicsConstantNode extends ClassicPreset.Node {
  label: string;
  op: PhysConstOp;
  width = 210;
  height = 110;

  constructor(init?: { label?: string; op?: PhysConstOp }) {
    super("PhysicsConstant");
    this.op = init?.op ?? "c";
    this.label = init?.label ?? "";
    this.addOutput("value", numOut("Value"));
  }

  data() {
    return { value: PHYS_CONSTANTS[this.op].value };
  }

  /** A custom suffix, because units like J·s are not Format Controller unit ids. */
  annotation(): FormatAnnotation {
    return { format: "auto", unit: "custom", customUnit: ` ${PHYS_CONSTANTS[this.op].unit}` };
  }
}
