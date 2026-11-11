// [[B15]] leanCore; the Probability pack's cards, tree/specs/computation/probability-pack.md.
import { GraphNode } from "../graphModel";
import { nodeOnCore } from "../nodeOnCore";
import { listIn, numIn, numOut } from "./shared";
import { DIST_SPECS, type DistKey } from "./distributionOps";
import type { SolError } from "../errorValue";
import type { FormatAnnotation } from "../formatAnnotationStore";

/** A probability or a lift shows as a percent; the value stays the fraction, and a docked Format Controller overrides it. */
const PERCENT: FormatAnnotation = { format: "percent", unit: "none" };

type Num = number | SolError | null;
type Plot = Array<number | null> | null;

// ─── Probability Between ──────────────────────────────────────────────────────

export type ProbBetweenOp = Extract<DistKey,
  "normal" | "t" | "chisq" | "f" | "beta" | "gamma" | "lognorm" | "weibull" | "expon"
  | "binom" | "poisson" | "hypgeom" | "negbinom">;

/** Where the handles start on each family: a range that shades a readable share of its default curve. */
const START: Record<ProbBetweenOp, [number, number]> = {
  normal: [-1, 1], t: [-2, 2], chisq: [2, 8], f: [0.5, 2], beta: [0.1, 0.4], gamma: [1, 6],
  lognorm: [0.5, 2], weibull: [1, 3], expon: [0.5, 2],
  binom: [3, 7], poisson: [1, 3], hypgeom: [1, 3], negbinom: [2, 6],
};

export const PROB_BETWEEN_OP_META = Object.fromEntries(
  (Object.keys(START) as ProbBetweenOp[]).map((op) => [op, { label: DIST_SPECS[op].label, group: DIST_SPECS[op].group }]),
) as Record<ProbBetweenOp, { label: string; group: string }>;

const isBetweenOp = (op: unknown): op is ProbBetweenOp => typeof op === "string" && op in START;

export class ProbabilityBetweenNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    lo: "Drag the left handle on the curve, or type a value. Empty, the range starts at −∞.",
    hi: "Drag the right handle on the curve, or type a value. Empty, the range runs to ∞.",
    result: "The share of the distribution between Low and High. A counting distribution includes both ends.",
  };

  label: string;
  op: ProbBetweenOp;
  cachedResult: Num = null;
  plotX: Plot = null;
  plotY: Plot = null;
  plotBars = false;
  shadeLo: number | null = null;
  shadeHi: number | null = null;
  literals: Record<string, number> = {};
  width = 240;
  height = 300;

  constructor(init?: { label?: string; op?: ProbBetweenOp }) {
    super("ProbabilityBetween");
    this.label = init?.label ?? "";
    this.op = isBetweenOp(init?.op) ? init.op : "normal";
    this.addInput("lo", numIn("Low"));
    this.addInput("hi", numIn("High"));
    for (const p of DIST_SPECS[this.op].params) this.addInput(p.key, numIn(p.label));
    this.addOutput("result", numOut("Probability"));
    this.seedLiterals(true);
  }

  get paramKeys(): string[] { return DIST_SPECS[this.op].params.map((p) => p.key); }

  private seedLiterals(handles: boolean): void {
    for (const p of DIST_SPECS[this.op].params) this.literals[p.key] ??= p.def;
    if (handles) [this.literals.lo, this.literals.hi] = START[this.op];
  }

  keysDroppedBySwitch(next: ProbBetweenOp): string[] {
    const keep = new Set(DIST_SPECS[next].params.map((p) => p.key));
    return this.paramKeys.filter((k) => !keep.has(k));
  }

  /** A new family's curve lives somewhere else, so the handles move to its starting range. */
  setOp(next: ProbBetweenOp): void {
    if (next === this.op || !isBetweenOp(next)) return;
    const before = this.paramKeys;
    this.op = next;
    const after = DIST_SPECS[next].params;
    for (const k of before) {
      if (!after.some((p) => p.key === k)) { this.removeInput(k); delete this.literals[k]; }
    }
    for (const p of after) {
      const live = this.inputs[p.key];
      if (live) live.label = p.label;
      else this.addInput(p.key, numIn(p.label));
    }
    this.seedLiterals(true);
  }

  annotationFor(outKey: string): FormatAnnotation | undefined {
    return outKey === "result" ? PERCENT : undefined;
  }

  data(inputs: Record<string, unknown[] | undefined> = {}): { result: Num } {
    return nodeOnCore(this, inputs) as { result: Num };
  }
}

// ─── A/B Test ─────────────────────────────────────────────────────────────────

export class AbTestNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    chance: "The probability that B's true rate is higher than A's, starting from no opinion about either.",
    lift: "How much higher B's rate is than A's, as a fraction: 0.1 is 10% higher. The middle of its likely range.",
    low: "With High, the range B's lift falls in with 95% probability.",
    high: "With Low, the range B's lift falls in with 95% probability.",
  };

  label: string;
  cachedChance: Num = null;
  cachedLift: Num = null;
  cachedLow: Num = null;
  cachedHigh: Num = null;
  plotX: Plot = null;
  plotA: Plot = null;
  plotB: Plot = null;
  literals: Record<string, number> = { na: 1000, ca: 50, nb: 1000, cb: 65 };
  width = 240;
  height = 360;

  constructor(init?: { label?: string }) {
    super("AbTest");
    this.label = init?.label ?? "";
    this.addInput("na", numIn("Visitors A"));
    this.addInput("ca", numIn("Conversions A"));
    this.addInput("nb", numIn("Visitors B"));
    this.addInput("cb", numIn("Conversions B"));
    this.addOutput("chance", numOut("B beats A"));
    this.addOutput("lift", numOut("Lift"));
    this.addOutput("low", numOut("Lift low"));
    this.addOutput("high", numOut("Lift high"));
  }

  annotationFor(outKey: string): FormatAnnotation | undefined {
    return outKey in this.outputs ? PERCENT : undefined;
  }

  data(inputs: Record<string, unknown[] | undefined> = {}): Record<"chance" | "lift" | "low" | "high", Num> {
    return nodeOnCore(this, inputs) as Record<"chance" | "lift" | "low" | "high", Num>;
  }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

export type BootstrapOp = "mean" | "median" | "stdev";

export const BOOTSTRAP_OP_META = {
  mean:   { label: "Mean",    description: "How far the average could be off" },
  median: { label: "Median",  description: "How far the middle value could be off" },
  stdev:  { label: "Std dev", description: "How far the spread could be off" },
} satisfies Record<BootstrapOp, { label: string; description: string }>;

const isBootstrapOp = (op: unknown): op is BootstrapOp => typeof op === "string" && op in BOOTSTRAP_OP_META;

export class BootstrapNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    list: "Blanks and text are skipped.",
    low: "With High, the middle 95% of the statistic across thousands of resamples of the values. The draws are the same every time.",
    high: "With Low, the middle 95% of the statistic across thousands of resamples of the values. The draws are the same every time.",
  };

  label: string;
  op: BootstrapOp;
  cachedResult: Num = null;
  cachedLow: Num = null;
  cachedHigh: Num = null;
  plotX: Plot = null;
  plotY: Plot = null;
  width = 240;
  height = 300;

  constructor(init?: { label?: string; op?: BootstrapOp }) {
    super("Bootstrap");
    this.label = init?.label ?? "";
    this.op = isBootstrapOp(init?.op) ? init.op : "mean";
    this.addInput("list", listIn("Values"));
    this.addOutput("estimate", numOut(BOOTSTRAP_OP_META[this.op].label));
    this.addOutput("low", numOut("Low"));
    this.addOutput("high", numOut("High"));
  }

  setOp(next: BootstrapOp): void {
    if (next === this.op || !isBootstrapOp(next)) return;
    this.op = next;
    const out = this.outputs.estimate;
    if (out) out.label = BOOTSTRAP_OP_META[next].label;
  }

  data(inputs: Record<string, unknown[] | undefined> = {}): Record<"estimate" | "low" | "high", Num> {
    return nodeOnCore(this, inputs) as Record<"estimate" | "low" | "high", Num>;
  }
}
