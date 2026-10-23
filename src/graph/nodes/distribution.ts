// [[B11]], [[D46]] freezeVolatilePerCalc
import { ClassicPreset } from "rete";
import { nodeOnCore } from "../nodeOnCore";
import { numIn, numListIn, numListOut, type BroadcastResult } from "./shared";
import { DIST_SPECS, isInverseForm, formAfterSwitch, type DistForm, type DistKey, type DistSpec } from "./distributionOps";
import { getRecalcGen } from "../process";
export { DIST_SPECS, DIST_FORM_META, isInverseForm, formAfterSwitch, type DistForm, type DistKey, type DistSpec } from "./distributionOps";

function firstKeyFor(op: DistKey, form: DistForm): string {
  return form === "sample" ? "count" : isInverseForm(form) ? "prob" : DIST_SPECS[op].xKey;
}
function inputKeysFor(op: DistKey, form: DistForm): string[] {
  const spec = DIST_SPECS[op];
  return [firstKeyFor(op, form), ...spec.params.map((p) => p.key)];
}

export class DistributionsNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    k: "The count rounds down to a whole number.",
    result: "A value or parameter outside the distribution's domain gives a blank, not an error.",
  };

  label: string;
  op: DistKey;
  form: DistForm;
  cachedResult: BroadcastResult = null;
  literals: Record<string, number> = {};
  width = 190;
  height = 200;

  constructor(init?: { label?: string; op?: DistKey; form?: DistForm }) {
    super("Distributions");
    this.label = init?.label ?? "";
    this.op = init?.op ?? "normal";
    const spec = DIST_SPECS[this.op];
    this.form = init?.form && spec.forms.includes(init.form) ? init.form : spec.forms[0];
    for (const key of inputKeysFor(this.op, this.form)) this.addInput(key, this.makeInput(key));
    this.addOutput("result", numListOut("Result"));
    this.seedLiterals();
    this.height = 203 + 28 * spec.params.length;
  }

  get spec(): DistSpec { return DIST_SPECS[this.op]; }
  get xKey(): string { return this.spec.xKey; }
  get paramKeys(): string[] { return this.spec.params.map((p) => p.key); }
  get inputKeys(): string[] { return inputKeysFor(this.op, this.form); }

  private makeInput(key: string) {
    const spec = this.spec;
    if (key === "prob") return numListIn(spec.probLabel ?? "Probability");
    if (key === "count") return numIn("Draws");
    if (key === spec.xKey) return numListIn(spec.xLabel);
    const param = spec.params.find((p) => p.key === key)!;
    return numListIn(param.label);
  }

  private seedLiterals(): void {
    const spec = this.spec;
    this.literals[spec.xKey] ??= spec.xDefault;
    this.literals.prob ??= 0.95;
    this.literals.count ??= 100;
    for (const p of spec.params) this.literals[p.key] ??= p.def;
  }

  keysDroppedBySwitch(next: DistKey): string[] {
    const keep = new Set(inputKeysFor(next, formAfterSwitch(this.form, next)));
    return inputKeysFor(this.op, this.form).filter((k) => !keep.has(k));
  }

  setOp(next: DistKey): void {
    if (next === this.op) return;
    const before = inputKeysFor(this.op, this.form);
    this.form = formAfterSwitch(this.form, next);
    this.op = next;
    const after = inputKeysFor(next, this.form);
    for (const k of before) if (!after.includes(k)) this.removeInput(k);
    for (const k of after) {
      const input = this.inputs[k];
      if (input) input.label = this.makeInput(k).label;
      else this.addInput(k, this.makeInput(k));
    }
    this.seedLiterals();
    this.height = 203 + 28 * this.spec.params.length;
  }

  keysDroppedByForm(next: DistForm): string[] {
    const before = firstKeyFor(this.op, this.form);
    return before === firstKeyFor(this.op, next) ? [] : [before];
  }

  setForm(next: DistForm): void {
    if (next === this.form || !this.spec.forms.includes(next)) return;
    const before = firstKeyFor(this.op, this.form);
    this.form = next;
    const after = firstKeyFor(this.op, next);
    if (before === after) return;
    if (this.inputs[before]) this.removeInput(before);
    if (!this.inputs[after]) this.addInput(after, this.makeInput(after));
    this.seedLiterals();
  }

  static coreFields = ["sampleSeed"];
  private lastSampleGen = -1;
  sampleSeed = 0;

  /** The sample form's seed is drawn here, once per recalc and card; `body` samples from it. */
  data(inputs: Record<string, unknown[] | undefined>) {
    const gen = getRecalcGen();
    if (this.form === "sample" && this.lastSampleGen !== gen) {
      this.lastSampleGen = gen;
      let h = 2166136261 ^ gen;
      for (const ch of this.id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
      this.sampleSeed = h >>> 0;
    }
    return this.body(inputs);
  }

  body(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: BroadcastResult };
  }
}
