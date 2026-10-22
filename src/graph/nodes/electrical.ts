// [[C76]] formulaPackDefault, [[C79]] packActivationIsPresentation

import { ClassicPreset } from "rete";
import { nodeOnCore } from "../nodeOnCore";
import { listIn, numIn, numOut } from "./shared";
import { type SolError } from "../errorValue";
import { decodeResistor, type ESeriesOp } from "./electricalOps";

export class ParallelCombineNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | SolError | null = null;
  width = 180;
  height = 140;

  constructor(init?: { label?: string }) {
    super("ParallelCombine");
    this.label = init?.label ?? "Parallel Combine";
    this.addInput("list", listIn("Values"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: number | SolError | null };
  }
}
export class ESeriesNode extends ClassicPreset.Node {
  label: string;
  op: ESeriesOp;
  literals: Record<string, number> = { value: 4600 };
  cachedNearest: number | SolError | null = null;
  cachedError: number | SolError | null = null;
  width = 200;
  height = 190;

  constructor(init?: { label?: string; op?: ESeriesOp }) {
    super("ESeries");
    this.label = init?.label ?? "";
    this.op = init?.op ?? "E24";
    this.addInput("value", numIn("Value"));
    this.addOutput("nearest", numOut("Nearest"));
    this.addOutput("errpct", numOut("Error %"));
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { nearest: number | SolError | null; errpct: number | SolError | null };
  }
}
export class AwgNode extends ClassicPreset.Node {
  label: string;
  literals: Record<string, number> = { gauge: 12 };
  cachedDiameter: number | SolError | null = null;
  cachedArea: number | SolError | null = null;
  cachedResistance: number | SolError | null = null;
  cachedAmpacity: number | SolError | null = null;
  width = 210;
  height = 220;

  constructor(init?: { label?: string }) {
    super("Awg");
    this.label = init?.label ?? "AWG Wire";
    this.addInput("gauge", numIn("Gauge"));
    this.addOutput("diameter", numOut("Ø mm"));
    this.addOutput("area", numOut("mm²"));
    this.addOutput("resistance", numOut("Ω/km"));
    this.addOutput("ampacity", numOut("Ampacity A"));
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { diameter: number | SolError | null; area: number | SolError | null; resistance: number | SolError | null; ampacity: number | SolError | null };
  }
}
export class ResistorCodeNode extends ClassicPreset.Node {
  label: string;
  bands: "4" | "5";
  stringLiterals: Record<string, string> = { b1: "brown", b2: "black", b3: "black", mult: "red", tol: "gold" };
  cachedOhms: number | SolError | null = null;
  cachedTol: number | SolError | null = null;
  width = 220;
  height = 230;

  constructor(init?: { label?: string; bands?: "4" | "5"; stringLiterals?: Record<string, string> }) {
    super("ResistorCode");
    this.label = init?.label ?? "Resistor Color Code";
    this.bands = init?.bands === "5" ? "5" : "4";
    if (init?.stringLiterals) this.stringLiterals = { ...this.stringLiterals, ...init.stringLiterals };
    this.addOutput("ohms", numOut("Ω"));
    this.addOutput("tolerance", numOut("± %"));
  }

  data() {
    const L = this.stringLiterals;
    const r = decodeResistor(L.b1, L.b2, L.b3, L.mult, L.tol, this.bands === "5");
    if ("code" in (r as object)) {
      this.cachedOhms = this.cachedTol = r as SolError;
      return { ohms: r as SolError, tolerance: r as SolError };
    }
    const { ohms, tolerance } = r as { ohms: number; tolerance: number };
    this.cachedOhms = ohms;
    this.cachedTol = tolerance;
    return { ohms, tolerance };
  }
}
