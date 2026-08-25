import { ClassicPreset } from "rete";
import { colord, extend, type Colord } from "colord";
import namesPlugin from "colord/plugins/names";

// Global: named CSS colors ("tomato") must parse everywhere colord is used.
extend([namesPlugin]);
import { numberSocket } from "../sockets";
import { numIn, strIn, strOut, logicalOut, dateOut, readInput } from "./shared";
import { solError, isSolError, type SolError } from "../errorValue";
import { jsDateToSerial } from "./dateSerial";
import { saveTimeStore } from "../saveTimeStore";

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

  data(): { value: number } {
    return { value: this.value };
  }
}

export type ColorMode = "rgb" | "hsv" | "hex";
// Output formats stay CSS-VALID only — there is no `hsv()` in CSS.
export type ColorFormat = "hex" | "rgb";

export class ColorPickerNode extends ClassicPreset.Node {
  label: string;
  mode: ColorMode;
  format: ColorFormat;
  // c0/c1/c2 read per mode (rgb 0–255; hsv 0–360 / 0–100); "hex" reads stringLiterals.
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

// W3C separable compositing per RGB channel on [0,1]: A is the BACKDROP, B the blend
// layer — the order matters for overlay, soft/hard light, dodge and burn.

export type BlendMode =
  | "mix" | "multiply" | "screen" | "overlay" | "soft-light" | "hard-light"
  | "darken" | "lighten" | "difference" | "exclusion" | "dodge" | "burn";

// W3C soft-light's darkness ramp for the backdrop channel.
const softLightD = (a: number) => (a <= 0.25 ? ((16 * a - 12) * a + 4) * a : Math.sqrt(a));

export const BLEND_MODE_META: Record<BlendMode, { label: string; blend: (a: number, b: number) => number }> = {
  mix:          { label: "Mix (average)", blend: (a, b) => (a + b) / 2 },
  multiply:     { label: "Multiply",      blend: (a, b) => a * b },
  screen:       { label: "Screen",        blend: (a, b) => a + b - a * b },
  overlay:      { label: "Overlay",       blend: (a, b) => (a <= 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b)) },
  "soft-light": { label: "Soft Light",    blend: (a, b) => (b <= 0.5 ? a - (1 - 2 * b) * a * (1 - a) : a + (2 * b - 1) * (softLightD(a) - a)) },
  "hard-light": { label: "Hard Light",    blend: (a, b) => (b <= 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b)) },
  darken:       { label: "Darken",        blend: (a, b) => Math.min(a, b) },
  lighten:      { label: "Lighten",       blend: (a, b) => Math.max(a, b) },
  difference:   { label: "Difference",    blend: (a, b) => Math.abs(a - b) },
  exclusion:    { label: "Exclusion",     blend: (a, b) => a + b - 2 * a * b },
  dodge:        { label: "Color Dodge",   blend: (a, b) => (a === 0 ? 0 : b >= 1 ? 1 : Math.min(1, a / (1 - b))) },
  burn:         { label: "Color Burn",    blend: (a, b) => (a >= 1 ? 1 : b <= 0 ? 0 : 1 - Math.min(1, (1 - a) / b)) },
};

export class ColorBlendNode extends ClassicPreset.Node {
  label: string;
  /** The blend-op selector — named `op` per selectorNamedOp so the family can declare. */
  op: BlendMode;
  // Defaults are two palette colors so the node shows a result cold.
  stringLiterals: Record<string, string> = { a: "#56b4e9", b: "#e69f00" };
  cachedString: string | SolError | null = null;
  width = 210;
  height = 190;

  constructor(init?: { label?: string; op?: BlendMode }) {
    super("ColorBlend");
    this.label = init?.label ?? "Color Blend";
    // Guard a stale op from an old save — fall back rather than crash data().
    this.op = init?.op && init.op in BLEND_MODE_META ? init.op : "mix";
    this.addInput("a", strIn("Color A"));
    this.addInput("b", strIn("Color B"));
    this.addOutput("color", strOut("Color"));
  }

  data(inputs: { a?: string[]; b?: string[] }): { color: string | SolError | null } {
    // Colors A and B are operands: a wired blank propagates (blank in, blank out), it is
    // not an invalid-color error. An untouched empty card ("") is still a #VALUE!.
    const parse = (key: "a" | "b", label: string) => {
      const raw = readInput(inputs[key], this.stringLiterals[key] ?? "");
      if (raw === null) return null;
      const s = String(raw).trim();
      const c = colord(s);
      return c.isValid() ? c : solError("#VALUE!", `${label} isn't a color: "${s}"`);
    };
    const a = parse("a", "Color A");
    const b = parse("b", "Color B");
    // An error outranks an unknown: the error branch runs before the blank one.
    const err = [a, b].find(isSolError);
    if (err) {
      this.cachedString = err;
      return { color: err };
    }
    if (a === null || b === null) {
      this.cachedString = null;
      return { color: null };
    }
    const ar = (a as Colord).toRgb();
    const br = (b as Colord).toRgb();
    const { blend } = BLEND_MODE_META[this.op];
    const ch = (x: number, y: number) => Math.round(Math.min(1, Math.max(0, blend(x / 255, y / 255))) * 255);
    const out = colord({ r: ch(ar.r, br.r), g: ch(ar.g, br.g), b: ch(ar.b, br.b) }).toHex();
    this.cachedString = out;
    return { color: out };
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

export class ConstantNode extends ClassicPreset.Node {
  label: string;
  op: ConstantOp;
  width = 160;
  height = 110;

  constructor(init?: { label?: string; op?: ConstantOp }) {
    super("Constant");
    // Guard a stale op from an old save rather than crash data() on CONSTANTS[op].
    this.op = init?.op && init.op in CONSTANTS ? init.op : "pi";
    this.label = init?.label ?? "";
    this.addOutput("value", new ClassicPreset.Output(numberSocket));
  }

  data() {
    return { value: CONSTANTS[this.op].value };
  }
}

export class SliderInputNode extends ClassicPreset.Node {
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
    this.addOutput("value", new ClassicPreset.Output(numberSocket));
  }

  data(inputs: { min?: number[]; max?: number[]; step?: number[] }) {
    // A Slider's CONTROL needs finite bounds to exist, so a wired blank bound — uniquely —
    // falls back to the card's own literal.
    const litMin  = this.literals.min  ?? 0;
    const litMax  = this.literals.max  ?? 100;
    const litStep = this.literals.step ?? 1;
    this.effectiveMin  = readInput(inputs.min,  litMin)  ?? litMin;
    this.effectiveMax  = readInput(inputs.max,  litMax)  ?? litMax;
    this.effectiveStep = readInput(inputs.step, litStep) ?? litStep;
    this.value = Math.min(Math.max(this.value, this.effectiveMin), this.effectiveMax);
    return { value: this.value };
  }
}

export class BooleanInputNode extends ClassicPreset.Node {
  label: string;
  value: 0 | 1;
  width = 160;
  height = 100;

  constructor(init?: { label?: string; value?: 0 | 1 }) {
    super("BooleanInput");
    this.label = init?.label ?? "Boolean Input";
    this.value = init?.value ?? 0;
    // A first-class logical output, NOT a number; the socket bridge coerces it to 1/0.
    this.addOutput("value", logicalOut("Value"));
  }

  // `value` stays 0|1 for the toggle UI + persistence; the EMITTED value is a real boolean.
  data() {
    return { value: this.value === 1 };
  }
}

/** Reads the save clock (`saveTimeStore` — the leaf seam over the current SolDoc's
 *  per-document timestamps), so the two serials refresh on any recompute and the
 *  card's Refresh button is just `requestRecalc()`. */
export class SaveTimesNode extends ClassicPreset.Node {
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
    this.cachedAutosave = auto === null ? null : jsDateToSerial(new Date(auto));
    this.cachedFileSave = file === null ? null : jsDateToSerial(new Date(file));
    return { autosave: this.cachedAutosave, filesave: this.cachedFileSave };
  }
}
