import { ClassicPreset } from "rete";
import { colord } from "colord";
import { numberSocket } from "../sockets";
import { numIn, strOut, logicalOut } from "./shared";

// ─── Number Input ────────────────────────────────────────────────────────────

export class NumberInputNode extends ClassicPreset.Node {
  label: string;
  value: number;
  width = 180;
  height = 100;

  constructor(init?: { label?: string; value?: number }) {
    super("NumberInput");
    this.label = init?.label ?? "Number Input";
    this.value = init?.value ?? 0;
    this.addOutput("value", new ClassicPreset.Output(numberSocket));
  }

  data() {
    return { value: this.value };
  }
}

// ─── Color Picker ─────────────────────────────────────────────────────────────
// Three sliders pick a colour in RGB or HSV; a format dropdown chooses how the
// output string reads (hex / rgb() / hsl()). The string drops straight into a
// Chart Builder's Colour field (all three formats are valid CSS colours).
// Conversion is delegated to `colord` (zero-dependency colour lib) so we don't
// hand-roll RGB↔HSV maths. Channel values live in `literals` (c0/c1/c2,
// interpreted per mode); `mode` + `format` are persisted via extractInit.

export type ColorMode = "rgb" | "hsv" | "hex";
// Output formats are CSS-valid only: there is no `hsv()` in CSS, so we don't
// offer an HSL output either (it'd mismatch the HSV input model) — hex / rgb
// cover everything a chart colour needs.
export type ColorFormat = "hex" | "rgb";

export class ColorPickerNode extends ClassicPreset.Node {
  label: string;
  mode: ColorMode;
  format: ColorFormat;
  // c0/c1/c2 read per mode — rgb: r,g,b ∈ [0,255]; hsv: h ∈ [0,360], s,v ∈ [0,100].
  // In "hex" mode the colour comes from stringLiterals.hex instead.
  literals: Record<string, number> = { c0: 86, c1: 180, c2: 233 }; // #56b4e9
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

  /** The colord instance for the current channels / hex + mode. */
  toColord() {
    if (this.mode === "hex") {
      const c = colord(this.stringLiterals.hex || "#000000");
      return c.isValid() ? c : colord("#000000");
    }
    const { c0, c1, c2 } = this.literals;
    return this.mode === "rgb"
      ? colord({ r: c0, g: c1, b: c2 })
      : colord({ h: c0, s: c1, v: c2 });
  }

  data() {
    const c = this.toColord();
    const out = this.format === "hex" ? c.toHex() : c.toRgbString();
    this.cachedString = out;
    return { color: out };
  }
}

// ─── Constant (predefined library) ───────────────────────────────────────────

// "na" was removed 2026-07 (audit finding 13): a NaN "constant" was one of THREE
// different not-really-#N/A producers; the NaNode (tagged SolError #N/A) is the
// one true NA now. No persistence alias, per pre-alpha policy — an old Constant
// saved as op:"na" loads as pi.
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

export class ConstantNode extends ClassicPreset.Node {
  label: string;
  op: ConstantOp;
  width = 160;
  height = 110;

  constructor(init?: { label?: string; op?: ConstantOp }) {
    super("Constant");
    // Guard a stale op from an old save (e.g. the removed "na") — fall back
    // rather than crash data() on CONSTANTS[op].value.
    this.op = init?.op && init.op in CONSTANTS ? init.op : "pi";
    this.label = init?.label ?? "Constant";
    this.addOutput("value", new ClassicPreset.Output(numberSocket));
  }

  data() {
    return { value: CONSTANTS[this.op].value };
  }
}

// ─── Slider Input ─────────────────────────────────────────────────────────────

export class SliderInputNode extends ClassicPreset.Node {
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
    this.addOutput("value", new ClassicPreset.Output(numberSocket));
  }

  data(inputs: { min?: number[]; max?: number[]; step?: number[] }) {
    this.effectiveMin  = inputs.min?.[0]  ?? this.literals.min  ?? 0;
    this.effectiveMax  = inputs.max?.[0]  ?? this.literals.max  ?? 100;
    this.effectiveStep = inputs.step?.[0] ?? this.literals.step ?? 1;
    this.value = Math.min(Math.max(this.value, this.effectiveMin), this.effectiveMax);
    return { value: this.value };
  }
}

// ─── Boolean Input ────────────────────────────────────────────────────────────

export class BooleanInputNode extends ClassicPreset.Node {
  label: string;
  value: 0 | 1;
  width = 160;
  height = 100;

  constructor(init?: { label?: string; value?: 0 | 1 }) {
    super("BooleanInput");
    this.label = init?.label ?? "Boolean Input";
    this.value = init?.value ?? 0;
    // First-class logical output (purple, TRUE/FALSE) — NOT a number. It still feeds
    // numeric inputs via the logical↔number socket bridge (coerced to 1/0).
    this.addOutput("value", logicalOut("Value"));
  }

  // `value` stays 0|1 for the toggle UI + persistence; the emitted value is a real
  // boolean (the runtime form of the logical type), so it renders TRUE/FALSE and
  // coerces to 1/0 only where a numeric input pulls it.
  data() {
    return { value: this.value === 1 };
  }
}
