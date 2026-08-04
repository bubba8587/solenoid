import { ClassicPreset } from "rete";
import { trueAnySocket, MutableSocket } from "../sockets";

// A cable bundler routing lane in_i → out_i. All MAX lanes are declared up-front so the
// engine + validator can address any lane; the component renders only the ones in use.

export const CONDUIT_MAX_LANES = 8;

export const conduitInKey  = (i: number) => `in_${i}`;
export const conduitOutKey = (i: number) => `out_${i}`;

/** Lane index from a Conduit socket key (`in_3`→3, `out_0`→0), else -1. */
export function conduitLaneOf(key: unknown, side: "in" | "out"): number {
  const prefix = side === "in" ? "in_" : "out_";
  if (typeof key !== "string" || !key.startsWith(prefix)) return -1;
  const i = Number(key.slice(prefix.length));
  return Number.isInteger(i) ? i : -1;
}

type ConnLike = { source: string; sourceOutput: string; target: string; targetInput: string };

/** Ghost cables bridging each lane of a deleted Conduit; the generic 1-in/1-out splice
 *  can't express this for a multi-lane bundle. Pure — the caller applies the result. */
export function conduitGhostSpecs(
  incoming: readonly ConnLike[],
  outgoing: readonly ConnLike[],
  existing: readonly ConnLike[],
): ConnLike[] {
  const outByLane = new Map<number, ConnLike>();
  for (const c of outgoing) {
    const i = conduitLaneOf(c.sourceOutput, "out");
    if (i >= 0) outByLane.set(i, c);
  }
  const specs: ConnLike[] = [];
  const seen = new Set<string>();
  const key = (s: ConnLike) => `${s.source}\u0000${s.sourceOutput}\u0000${s.target}\u0000${s.targetInput}`;
  for (const inc of incoming) {
    const i = conduitLaneOf(inc.targetInput, "in");
    if (i < 0) continue;
    const out = outByLane.get(i);
    if (!out || inc.source === out.target) continue;
    const spec = { source: inc.source, sourceOutput: inc.sourceOutput, target: out.target, targetInput: out.targetInput };
    const k = key(spec);
    if (seen.has(k)) continue;
    if (existing.some((c) => key(c) === k)) continue;
    seen.add(k);
    specs.push(spec);
  }
  return specs;
}

// Session-global counter: loading or pasting a numbered conduit bumps it past that number
// so fresh ones never collide; an explicit n is returned as-is, duplicates allowed.
let _nextSeq = 1;
function claimSeq(n?: number): number {
  if (n != null && Number.isFinite(n)) {
    const v = Math.max(1, Math.floor(n));
    _nextSeq = Math.max(_nextSeq, v + 1);
    return v;
  }
  return _nextSeq++;
}

export class ConduitNode extends ClassicPreset.Node {
  /** Keeps `UnitCell` tags on its inputs — runs the dimension algebra itself (FC A4; see coerceInputs). */
  unitAware = true;
  label: string;
  seq: number;
  angle: number;
  // Fixed hit-area box — keep in sync with CONDUIT_BODY_SIZE (ribbonCable.ts).
  width = 92;
  height = 92;
  // Per-lane mirror so the component reads latest values without re-running the engine.
  cachedLane: Array<unknown> = new Array(CONDUIT_MAX_LANES).fill(null);

  constructor(init?: { label?: string; angle?: number; seq?: number }) {
    super("Conduit");
    this.seq = claimSeq(init?.seq);
    // The bare "Conduit" default from older saves upgrades to the numbered form.
    this.label = init?.label && init.label !== "Conduit" ? init.label : `Conduit ${this.seq}`;
    this.angle = init?.angle ?? 0;
    for (let i = 0; i < CONDUIT_MAX_LANES; i++) {
      // Input must be `trueany` (the SUPREMUM) — a plain `any` is scalar-only and would
      // reject an `anylist`. The output is MUTABLE so the lane carries its adopted type on.
      this.addInput(conduitInKey(i), new ClassicPreset.Input(trueAnySocket));
      this.addOutput(conduitOutKey(i), new ClassicPreset.Output(new MutableSocket("trueany")));
    }
  }

  /** Bump rotation by `steps` × 45° (the quantised step), wrapped to [0, 360). */
  rotateBy(steps: number) {
    const next = (Math.round(this.angle / 45) + steps) * 45;
    this.angle = ((next % 360) + 360) % 360;
  }

  /** Renumber. A derived label ("Conduit N") follows; a custom one is kept. */
  setSeq(n: number) {
    const derived = this.label === `Conduit ${this.seq}`;
    this.seq = claimSeq(n);
    if (derived) this.label = `Conduit ${this.seq}`;
  }

  /** Fresh number for a pasted clone (copy carries `seq`, which must not dup). */
  assignFreshSeq() {
    const derived = this.label === `Conduit ${this.seq}`;
    this.seq = claimSeq();
    if (derived) this.label = `Conduit ${this.seq}`;
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    const out: Record<string, unknown> = {};
    for (let i = 0; i < CONDUIT_MAX_LANES; i++) {
      const v = inputs[conduitInKey(i)]?.[0] ?? null;
      this.cachedLane[i] = v;
      out[conduitOutKey(i)] = v;
    }
    return out;
  }
}
