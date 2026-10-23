// [[C76]] formulaPackDefault, [[C17]] shareImpl

import { GraphNode } from "../graphModel";
import { nodeOnCore } from "../nodeOnCore";
import { numIn, numOut } from "./shared";
import { type SolError } from "../errorValue";
import { type AntoineOp } from "./thermoOps";

export class IsaAtmosphereNode extends GraphNode {
  label: string;
  literals: Record<string, number> = { alt: 0 };
  cachedT: number | SolError | null = null;
  cachedP: number | SolError | null = null;
  cachedRho: number | SolError | null = null;
  cachedA: number | SolError | null = null;
  width = 220;
  height = 220;

  constructor(init?: { label?: string }) {
    super("IsaAtmosphere");
    this.label = init?.label ?? "Standard Atmosphere";
    this.addInput("alt", numIn("Altitude m"));
    this.addOutput("temp", numOut("T (K)"));
    this.addOutput("pressure", numOut("p (Pa)"));
    this.addOutput("density", numOut("ρ (kg/m³)"));
    this.addOutput("sound", numOut("a (m/s)"));
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { temp: number | SolError | null; pressure: number | SolError | null; density: number | SolError | null; sound: number | SolError | null };
  }
}

export class AntoineNode extends GraphNode {
  label: string;
  substance: AntoineOp;
  literals: Record<string, number> = { t: 25 };
  cachedP: number | SolError | null = null;
  cachedBp: number | null = null;
  width = 220;
  height = 190;

  constructor(init?: { label?: string; substance?: AntoineOp }) {
    super("Antoine");
    this.substance = init?.substance ?? "water";
    this.label = init?.label ?? "Vapor Pressure";
    this.addInput("t", numIn("T °C"));
    this.addOutput("pressure", numOut("p (Pa)"));
    this.addOutput("bp", numOut("Boiling °C"));
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { pressure: number | SolError | null; bp: number };
  }
}
