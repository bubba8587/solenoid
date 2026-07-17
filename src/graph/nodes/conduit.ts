import { ClassicPreset } from "rete";
import { trueAnySocket, MutableSocket } from "../sockets";

// ─── Conduit ──────────────────────────────────────────────────────────────────

// A single-block cable bundler. Lane i routes in_i → out_i (output mirrors
// input). Up to CONDUIT_MAX_LANES "Any" cables enter one face and leave the
// opposite face. One rotation angle for the whole block (no per-lane spacing):
// when deselected the block compresses so the lanes bunch into a single pill,
// and expands (sockets fan out) when it's selected or a cable is dragged near.
// All MAX lanes are declared up-front so the
// engine + connection validator can address any lane; the component renders only
// as many as are in use.

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

/**
 * Per-lane rewire specs for a deleted Conduit. Pairs each incoming lane (`in_i`)
 * with its outgoing lane (`out_i`) and yields a ghost cable from the upstream
 * source to the downstream target — the unambiguous per-lane rewire that the
 * generic 1-in/1-out splice can't express for a multi-lane bundle. Skips a lane
 * missing either end, a self-loop (upstream === downstream), an already-existing
 * wire, and duplicate specs. Pure; the caller applies the result.
 */
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

// Sequential identity: every Conduit gets a small human number ("Conduit 3")
// so identical-looking blocks stay tellable-apart in pickers and wired markers.
// Session-global counter; loading or pasting a numbered conduit bumps it past
// that number so fresh ones never collide. Claiming an explicit n returns n
// (the user may deliberately renumber, duplicates included — their call).
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
  // The visible block can extend beyond it when expanded; the minimap uses this
  // footprint.
  width = 92;
  height = 92;
  // Per-lane mirror of incoming values so the component can read latest values
  // (e.g. to color the internal cables) without re-running the engine.
  cachedLane: Array<unknown> = new Array(CONDUIT_MAX_LANES).fill(null);

  constructor(init?: { label?: string; angle?: number; seq?: number }) {
    super("Conduit");
    this.seq = claimSeq(init?.seq);
    // The label stays derived ("Conduit N") until the user renames it; older
    // saves carry the bare "Conduit" default, which we upgrade to the numbered
    // form so loaded conduits aren't all identically anonymous.
    this.label = init?.label && init.label !== "Conduit" ? init.label : `Conduit ${this.seq}`;
    this.angle = init?.angle ?? 0;
    for (let i = 0; i < CONDUIT_MAX_LANES; i++) {
      // Input is a shared `trueany` singleton — the SUPREMUM wildcard, so a lane
      // accepts ANY cable (the Conduit's whole point): scalars, lists (an `anylist`
      // off a List Filter), tables, frames, cubes. (A plain `any` is scalar-only —
      // it rejected an `anylist`, the bug.) The OUTPUT is a per-lane MUTABLE socket
      // that ADOPTS the wired-in type (see reconcileConduitTypes in conduitTrace.ts),
      // so a lane genuinely carries its type downstream — a date leaves as a date
      // (FC can lock it, a Display formats it), not an opaque wildcard.
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
