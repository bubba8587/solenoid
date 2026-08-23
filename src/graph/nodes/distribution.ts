import { ClassicPreset } from "rete";
import { numListIn, numListOut, readInput, broadcast, type BroadcastResult } from "./shared";
import { DIST_SPECS, isInverseForm, formAfterSwitch, type DistForm, type DistKey, type DistSpec } from "./distributionOps";
export { DIST_SPECS, DIST_FORM_META, isInverseForm, formAfterSwitch, type DistForm, type DistKey, type DistSpec } from "./distributionOps";

// ─── The one Distribution node ────────────────────────────────────────────────
function inputKeysFor(op: DistKey, form: DistForm): string[] {
  const spec = DIST_SPECS[op];
  return [isInverseForm(form) ? "prob" : spec.xKey, ...spec.params.map((p) => p.key)];
}

export class DistributionNode extends ClassicPreset.Node {
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
    super("Distribution");
    this.label = init?.label ?? "Distribution";
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

  private makeInput(key: string) {
    const spec = this.spec;
    if (key === "prob") return numListIn(spec.probLabel ?? "Probability");
    if (key === spec.xKey) return numListIn(spec.xLabel);
    const param = spec.params.find((p) => p.key === key)!;
    return numListIn(param.label);
  }

  private seedLiterals(): void {
    const spec = this.spec;
    this.literals[spec.xKey] ??= spec.xDefault;
    this.literals.prob ??= 0.95;
    for (const p of spec.params) this.literals[p.key] ??= p.def;
  }

  /** The keys a switch to `next` would remove. Callers on a live graph prune
   *  these BEFORE calling setOp (onePrunePath). */
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
    for (const k of after) if (!this.inputs[k]) this.addInput(k, this.makeInput(k));
    this.seedLiterals();
    this.height = 203 + 28 * this.spec.params.length;
  }

  /** Crossing the forward/inverse line swaps the first input; callers prune the
   *  departing key's cables first. */
  setForm(next: DistForm): void {
    if (next === this.form || !this.spec.forms.includes(next)) return;
    const wasInv = isInverseForm(this.form);
    this.form = next;
    const nowInv = isInverseForm(next);
    if (wasInv === nowInv) return;
    if (nowInv) {
      if (this.inputs[this.xKey]) this.removeInput(this.xKey);
      if (!this.inputs.prob) this.addInput("prob", this.makeInput("prob"));
    } else {
      if (this.inputs.prob) this.removeInput("prob");
      if (!this.inputs[this.xKey]) this.addInput(this.xKey, this.makeInput(this.xKey));
    }
  }

  data(inputs: Record<string, (number | number[] | null)[] | undefined>) {
    const spec = this.spec;
    const form = this.form;
    const firstKey = isInverseForm(form) ? "prob" : spec.xKey;
    const first = readInput(inputs[firstKey], this.literals[firstKey]);
    const params = spec.params.map((p) => readInput(inputs[p.key], this.literals[p.key]));
    const result = broadcast((v, ...ps) => {
      const r = spec.compute(form, v, ps);
      return r !== null && Number.isFinite(r) ? r : null;
    }, first, ...params);
    this.cachedResult = result;
    return { result };
  }
}
