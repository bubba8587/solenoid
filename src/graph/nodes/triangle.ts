// [[C25]]

import { ClassicPreset } from "rete";
import { nodeOnCore } from "../nodeOnCore";
import { numListIn, numListOut, logicalComboOut } from "./shared";
import type { SolError } from "../errorValue";
import { PART_KEYS } from "./triangleOps";
import type { FormatAnnotation } from "../formatAnnotationStore";
import type { UnitCell } from "../unitValue";

type PartCell = number | SolError | null;
type PartOut = PartCell | UnitCell | (PartCell | UnitCell)[];

export class TriangleSolverNode extends ClassicPreset.Node {
  label: string;
  cachedValues: Record<string, PartOut> = {};
  cachedArea: PartOut = null;
  cachedPerimeter: PartOut = null;
  cachedValid: boolean | SolError | null | (boolean | SolError | null)[] = null;
  solvedKeys: string[] = [];
  width = 240;
  height = 430;

  annotationFor(outKey: string): FormatAnnotation | undefined {
    return outKey === "A" || outKey === "B" || outKey === "C"
      ? { format: "auto", unit: "deg" }
      : undefined;
  }

  constructor(init?: { label?: string }) {
    super("TriangleSolver");
    this.label = init?.label ?? "Triangle Solver";
    for (const k of PART_KEYS) {
      this.addInput(k, numListIn(k.toUpperCase() === k ? `${k} \u00b0` : k));
      this.addOutput(k, numListOut(k.toUpperCase() === k ? `${k} \u00b0` : k));
    }
    this.addOutput("area", numListOut("Area"));
    this.addOutput("perimeter", numListOut("Perimeter"));
    this.addOutput("valid", logicalComboOut("Valid"));
  }

  unitAware = true;

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as Record<string, unknown>;
  }
}
