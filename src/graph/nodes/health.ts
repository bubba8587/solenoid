// [[C76]] formulaPackDefault, [[C17]] shareImpl, [[C15]] matricesInFormulas

import { GraphNode } from "../graphModel";
import { nodeOnCore } from "../nodeOnCore";
import { numIn, frameOut } from "./shared";
import type { FrameValue } from "../frame";
import { shapeOfFrameValue, type Shape } from "../frameShape";
import { type SolError } from "../errorValue";
import { ZONES, hrZoneBounds } from "./healthOps";

export function hrZonesFrame(maxHr: number, restingHr: number | null): FrameValue {
  const bounds = hrZoneBounds(maxHr, restingHr);
  return {
    __frame: true,
    columns: [
      { name: "Zone", type: "string", values: ZONES.map((z) => z.name) },
      { name: "Low", type: "number", values: bounds.map((r) => r[0]) },
      { name: "High", type: "number", values: bounds.map((r) => r[1]) },
    ],
  };
}

export class HrZonesNode extends GraphNode {
  label: string;
  literals: Record<string, number> = { age: 30 };
  cachedFrame: FrameValue | SolError | null = null;
  width = 220;
  height = 190;

  constructor(init?: { label?: string }) {
    super("HrZones");
    this.label = init?.label ?? "Heart-Rate Zones";
    this.addInput("age", numIn("Age"));
    this.addInput("resting", numIn("Resting HR"));
    this.addInput("max", numIn("Max HR"));
    this.addOutput("zones", frameOut("Zones"));
  }

  frameShape(): Shape {
    return shapeOfFrameValue(hrZonesFrame(0, null));
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { zones: FrameValue | SolError | null };
  }
}
