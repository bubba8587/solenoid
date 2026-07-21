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
  /** The actual INPUT values swept — so the swing can be read against the width
   *  of the perturbation that produced it (a Slider's full declared range is a
   *  much wider nudge than a Number's ±10%). */
  inputLow: number;
  inputHigh: number;
  /** Where the perturbation width came from: a Slider's declared min/max, or a
   *  Number's ±10%. The tornado shows RAW swing (traditional), so this is the
   *  BASIS MARKER that keeps the ranking honest instead of silently normalizing. */
  basis: "slider" | "number";
  /** The result at an extreme was non-finite (NaN/±∞) — the swing couldn't be
   *  measured. Such a leaf is kept and MARKED (not silently dropped): the model
   *  blows up on this input, arguably the most sensitive finding. */
  diverged: boolean;
}

export class TornadoNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | null = null;
  /** Last completed run's ranking, best (biggest swing) first. Null = never run. */
  results: TornadoResult[] | null = null;
  // Rendered on the --wide (240px) card via nodeWide(); the inline chart is sized
  // to fit that (see TORNADO_W). Keep this hint in sync so ELK reserves the right
  // footprint.
  width = 240;
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
