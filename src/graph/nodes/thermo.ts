// [[composite-nodes#Packs]], [[C17]] shareImpl

import { GraphNode } from "../graphModel";
import { nodeOnCore } from "../nodeOnCore";
import { numIn, numOut, type Quantity } from "./shared";
import { type AntoineOp } from "./thermoOps";

export class IsaAtmosphereNode extends GraphNode {
  label: string;
  literals: Record<string, number> = { alt: 0 };
  cachedT: Quantity = null;
  cachedP: Quantity = null;
  cachedRho: Quantity = null;
  cachedA: Quantity = null;
  unitAware = true;
  width = 220;
  height = 220;

  constructor(init?: { label?: string }) {
    super("IsaAtmosphere");
    this.label = init?.label ?? "Standard Atmosphere";
    this.addInput("alt", numIn("Altitude m"));
    this.addOutput("temp", numOut("Temperature"));
    this.addOutput("pressure", numOut("Pressure"));
    this.addOutput("density", numOut("Density"));
    this.addOutput("sound", numOut("Speed of sound"));
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { temp: Quantity; pressure: Quantity; density: Quantity; sound: Quantity };
  }
}

export class AntoineNode extends GraphNode {
  label: string;
  substance: AntoineOp;
  literals: Record<string, number> = {};
  cachedP: Quantity = null;
  cachedBp: Quantity = null;
  unitAware = true;
  width = 220;
  height = 190;

  constructor(init?: { label?: string; substance?: AntoineOp }) {
    super("Antoine");
    this.substance = init?.substance ?? "water";
    this.label = init?.label ?? "Vapor Pressure";
    this.addInput("t", numIn("T °C"));
    this.addOutput("pressure", numOut("Pressure"));
    this.addOutput("bp", numOut("Boiling point"));
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { pressure: Quantity; bp: Quantity };
  }
}
