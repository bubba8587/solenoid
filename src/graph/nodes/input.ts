// [[C28]] literalsIffEditable
import { GraphNode, GraphOutput } from "../graphModel";
import { nodeOnCore } from "../nodeOnCore";
import { numberSocket } from "../sockets";
import { numIn, strIn, strOut, dateOut } from "./shared";
import { type SolError } from "../errorValue";
import { wallClockSerial } from "./dateSerial";
import { saveTimeStore } from "../saveTimeStore";

export type ColorMode = "rgb" | "hsv" | "hex";
// Output formats stay CSS-valid; CSS has no hsv().
export type ColorFormat = "hex" | "rgb";

export class ColorPickerNode extends GraphNode {
  label: string;
  mode: ColorMode;
  format: ColorFormat;
  // c0 to c2 read per mode (rgb 0–255; hsv 0–360 and 0–100); hex mode reads stringLiterals.
  literals: Record<string, number> = { c0: 86, c1: 180, c2: 233 };
  stringLiterals: Record<string, string> = { hex: "#56b4e9" };
  cachedString = "";
  width = 200;
  height = 220;

  constructor(init?: { label?: string; mode?: ColorMode; format?: ColorFormat; c0?: number; c1?: number; c2?: number }) {
    super("ColorPicker");
    this.label = init?.label ?? "Color";
    this.mode = init?.mode ?? "rgb";
    this.format = init?.format ?? "hex";
    if (init?.c0 !== undefined) this.literals.c0 = init.c0;
    if (init?.c1 !== undefined) this.literals.c1 = init.c1;
    if (init?.c2 !== undefined) this.literals.c2 = init.c2;
    this.addOutput("color", strOut("Color"));
  }

  data(inputs: Record<string, unknown[] | undefined> = {}) {
    return nodeOnCore(this, inputs) as { color: string };
  }
}

export type BlendMode =
  | "mix" | "multiply" | "screen" | "overlay" | "soft-light" | "hard-light"
  | "darken" | "lighten" | "difference" | "exclusion" | "dodge" | "burn";

export const BLEND_MODE_META: Record<BlendMode, { label: string }> = {
  mix:          { label: "Mix (average)" },
  multiply:     { label: "Multiply" },
  screen:       { label: "Screen" },
  overlay:      { label: "Overlay" },
  "soft-light": { label: "Soft Light" },
  "hard-light": { label: "Hard Light" },
  darken:       { label: "Darken" },
  lighten:      { label: "Lighten" },
  difference:   { label: "Difference" },
  exclusion:    { label: "Exclusion" },
  dodge:        { label: "Color Dodge" },
  burn:         { label: "Color Burn" },
};

export class ColorBlendNode extends GraphNode {
  label: string;
  mode: BlendMode;
  stringLiterals: Record<string, string> = { a: "#56b4e9", b: "#e69f00" };
  cachedString: string | SolError | null = null;
  width = 210;
  height = 190;

  constructor(init?: { label?: string; mode?: BlendMode }) {
    super("ColorBlend");
    this.label = init?.label ?? "Color Blend";
    this.mode = init?.mode ?? "mix";
    this.addInput("a", strIn("Color A"));
    this.addInput("b", strIn("Color B"));
    this.addOutput("color", strOut("Color"));
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { color: string | SolError | null };
  }
}

// There is no `na` constant: the NaNode (tagged SolError #N/A) is the one true NA.
export type ConstantOp =
  | "pi" | "tau" | "e" | "phi"
  | "inf" | "neg-inf"
  | "zero" | "one" | "neg-one"
  | "true" | "false";

export const CONSTANTS: Record<ConstantOp, { symbol: string; label: string; value: number }> = {
  pi:        { symbol: "π",     label: "Pi",            value: Math.PI },
  tau:       { symbol: "τ",     label: "Tau",           value: 2 * Math.PI },
  e:         { symbol: "e",     label: "Euler's e",     value: Math.E },
  phi:       { symbol: "φ",     label: "Golden ratio",  value: (1 + Math.sqrt(5)) / 2 },
  inf:       { symbol: "∞",     label: "Infinity",      value: Infinity },
  "neg-inf": { symbol: "−∞",    label: "Negative ∞",    value: -Infinity },
  zero:      { symbol: "0",     label: "Zero",          value: 0 },
  one:       { symbol: "1",     label: "One",           value: 1 },
  "neg-one": { symbol: "−1",    label: "Negative one",  value: -1 },
  "true":    { symbol: "true",  label: "True",          value: 1 },
  "false":   { symbol: "false", label: "False",         value: 0 },
};

export class ConstantNode extends GraphNode {
  label: string;
  op: ConstantOp;
  width = 160;
  height = 110;

  constructor(init?: { label?: string; op?: ConstantOp }) {
    super("Constant");
    this.op = init?.op ?? "pi";
    this.label = init?.label ?? "";
    this.addOutput("value", new GraphOutput(numberSocket));
  }

  data(inputs: Record<string, unknown[] | undefined> = {}) {
    return nodeOnCore(this, inputs) as { value: number };
  }
}

export class SliderInputNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    min: "Wiring a bound clamps the slider's value to it immediately. A blank on the cable falls back to the bound typed on the card.",
    max: "Wiring a bound clamps the slider's value to it immediately. A blank on the cable falls back to the bound typed on the card.",
  };
  label: string;
  value: number;
  literals: Record<string, number> = { min: 0, max: 100, step: 1 };
  // Effective bounds after resolving wired inputs — read by the component.
  effectiveMin  = 0;
  effectiveMax  = 100;
  effectiveStep = 1;
  width = 200;
  height = 258;

  constructor(init?: { label?: string; value?: number; min?: number; max?: number; step?: number }) {
    super("SliderInput");
    this.label = init?.label ?? "Slider";
    this.value = init?.value ?? 50;
    if (init?.min  !== undefined) this.literals.min  = init.min;
    if (init?.max  !== undefined) this.literals.max  = init.max;
    if (init?.step !== undefined) this.literals.step = init.step;
    this.addInput("min",  numIn("Min"));
    this.addInput("max",  numIn("Max"));
    this.addInput("step", numIn("Step"));
    this.addOutput("value", new GraphOutput(numberSocket));
  }

  /** The body keeps the clamped value it answers, which is saved. */
  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { value: number };
  }
}

/** Reads saveTimeStore, so both serials refresh on any recompute and the card's Refresh is just requestRecalc(). */
export class SaveTimesNode extends GraphNode {
  label: string;
  cachedAutosave: number | null = null;
  cachedFileSave: number | null = null;
  width  = 220;
  height = 170;

  constructor(init?: { label?: string }) {
    super("SaveTimes");
    this.label = init?.label ?? "Save Times";
    this.addOutput("autosave", dateOut("Autosaved"));
    this.addOutput("filesave", dateOut("Saved"));
  }

  data(): { autosave: number | null; filesave: number | null } {
    const auto = saveTimeStore.lastAutosaveAt();
    const file = saveTimeStore.lastFileSaveAt();
    this.cachedAutosave = auto === null ? null : wallClockSerial(new Date(auto));
    this.cachedFileSave = file === null ? null : wallClockSerial(new Date(file));
    return { autosave: this.cachedAutosave, filesave: this.cachedFileSave };
  }
}
