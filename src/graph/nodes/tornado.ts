import { ClassicPreset } from "rete";
import { numIn, numOut } from "./shared";

// ─── Tornado — one-at-a-time sensitivity ranking ──────────────────────────────
// Confirmed genuinely new (DecisionSensitivityNode is Decision-Matrix-specific
// scenario sensitivity, not a generic parameter sweep). Wire any numeric value
// in; the "Run sensitivity" button on the card (see components/TornadoNode.tsx +
// tornadoRun.ts) walks upstream to the leaf Number/Slider inputs feeding it,
// perturbs each one ±10% (or its declared Slider min/max) one at a time, re-reads
// this node's own value after each perturbation, and ranks the swings — the
// classic one-at-a-time tornado-chart sensitivity sweep. Pass-through so it can
// still sit inline in a chain.

export interface TornadoResult {
  nodeId: string;
  label: string;
  base: number;
  low: number;
  high: number;
}

export class TornadoNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | null = null;
  /** Last completed run's ranking, best (biggest swing) first. Null = never run. */
  results: TornadoResult[] | null = null;
  width = 300;
  height = 280;

  constructor(init?: { label?: string }) {
    super("Tornado");
    this.label = init?.label ?? "Tornado";
    this.addInput("value", numIn("Value"));
    this.addOutput("out", numOut("Pass-through"));
  }

  data(inputs: { value?: number[] }) {
    const v = inputs.value?.[0] ?? null;
    this.cachedResult = v;
    return { out: v };
  }
}
