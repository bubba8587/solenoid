import { ClassicPreset } from "rete";
import { numIn, numListIn, numListOut, readInput, broadcast, type BroadcastResult } from "./shared";
import { DIST_SPECS, isInverseForm, formAfterSwitch, sampleQuantile, type DistForm, type DistKey, type DistSpec } from "./distributionOps";
import { mulberry32 } from "../monteCarlo";
import { getRecalcGen } from "../process";
export { DIST_SPECS, DIST_FORM_META, isInverseForm, formAfterSwitch, type DistForm, type DistKey, type DistSpec } from "./distributionOps";

// ─── The one Distribution node ────────────────────────────────────────────────
/** The first socket follows the form: an x for the curves, a probability for the
 *  inverses, a count for `sample`. */
function firstKeyFor(op: DistKey, form: DistForm): string {
  return form === "sample" ? "count" : isInverseForm(form) ? "prob" : DIST_SPECS[op].xKey;
}
function inputKeysFor(op: DistKey, form: DistForm): string[] {
  const spec = DIST_SPECS[op];
  return [firstKeyFor(op, form), ...spec.params.map((p) => p.key)];
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
    const before = firstKeyFor(this.op, this.form);
    this.form = next;
    const after = firstKeyFor(this.op, next);
    if (before === after) return;
    if (this.inputs[before]) this.removeInput(before);
    if (!this.inputs[after]) this.addInput(after, this.makeInput(after));
    this.seedLiterals();
  }

  /** The `sample` form's draws re-roll once per recalculation (getRecalcGen, like RAND) and
   *  are otherwise stable, seeded from the node id so two cards don't share a stream. */
  private lastSampleGen = -1;
  private sampleSeed = 0;

  data(inputs: Record<string, (number | number[] | null)[] | undefined>) {
    const spec = this.spec;
    const form = this.form;
    if (form === "sample") {
      const countRaw = readInput(inputs.count, this.literals.count ?? 100);
      const params = spec.params.map((p) => readInput(inputs[p.key], this.literals[p.key]));
      if (countRaw === null || params.some((v) => v === null)) { this.cachedResult = null; return { result: null }; }
      const n = Math.min(100_000, Math.max(0, Math.round(Array.isArray(countRaw) ? (countRaw[0] ?? 0) : countRaw)));
      const ps = params.map((v) => (Array.isArray(v) ? (v[0] ?? 0) : (v as number)));
      const gen = getRecalcGen();
      if (this.lastSampleGen !== gen) {
        this.lastSampleGen = gen;
        let h = 2166136261 ^ gen;
        for (const ch of this.id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
        this.sampleSeed = h >>> 0;
      }
      const rng = mulberry32(this.sampleSeed);
      const out: (number | null)[] = [];
      for (let i = 0; i < n; i++) { const v = sampleQuantile(this.op, rng(), ps); out.push(v !== null && Number.isFinite(v) ? v : null); }
      this.cachedResult = out;
      return { result: out };
    }
    const firstKey = firstKeyFor(this.op, form);
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
