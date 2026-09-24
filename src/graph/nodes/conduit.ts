// [[D35]] errorInErrorOut, [[D42]] perInputUnitBlind, [[C27]] noDataInComponents
// Mechanics: [[conduit-lane-faces]]. All CONDUIT_MAX_LANES lanes are declared up front, since the engine and validator address any lane.
import { ClassicPreset } from "rete";
import { trueAnySocket, MutableSocket } from "../sockets";

export const CONDUIT_MAX_LANES = 8;

export const conduitInKey  = (i: number) => `in_${i}`;
export const conduitOutKey = (i: number) => `out_${i}`;

export function conduitLaneOf(key: unknown, side: "in" | "out"): number {
  const prefix = side === "in" ? "in_" : "out_";
  if (typeof key !== "string" || !key.startsWith(prefix)) return -1;
  const i = Number(key.slice(prefix.length));
  return Number.isInteger(i) ? i : -1;
}

type ConnLike = { source: string; sourceOutput: string; target: string; targetInput: string };

/** The generic 1-in/1-out splice cannot bridge a multi-lane bundle. Pure: the caller applies the result. */
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

// Session-global: loading or pasting a numbered conduit bumps the counter past its number, and an explicit n is returned as is.
let _nextSeq = 1;
function claimSeq(n?: number): number {
  if (n != null && Number.isFinite(n)) {
    const v = Math.max(1, Math.floor(n));
    _nextSeq = Math.max(_nextSeq, v + 1);
    return v;
  }
  return _nextSeq++;
}

/** On the 45° quantum and in [0, 360), whatever a save or a caller hands in. */
export function snapConduitAngle(deg: unknown): number {
  const d = typeof deg === "number" && Number.isFinite(deg) ? deg : 0;
  const s = Math.round(d / 45) * 45;
  return ((s % 360) + 360) % 360;
}

/** Another Conduit in the same graph already holds `n`, so both would read "Conduit N". */
export function conduitSeqTaken(nodes: Iterable<object>, self: object, n: number): boolean {
  for (const other of nodes) {
    if (other !== self && other instanceof ConduitNode && other.seq === n) return true;
  }
  return false;
}

export class ConduitNode extends ClassicPreset.Node {
  /** Lanes forward tags untouched ([[D42]] perInputUnitBlind). */
  unitAware = true;
  label: string;
  seq: number;
  angle: number;
  // Fixed hit-area box — keep in sync with CONDUIT_BODY_SIZE (ribbonCable.ts).
  width = 92;
  height = 92;
  // Per-lane mirror the component reads ([[C27]] noDataInComponents).
  cachedLane: Array<unknown> = new Array(CONDUIT_MAX_LANES).fill(null);

  constructor(init?: { label?: string; angle?: number; seq?: number }) {
    super("Conduit");
    this.seq = claimSeq(init?.seq);
    this.label = init?.label && init.label !== "Conduit" ? init.label : `Conduit ${this.seq}`;
    this.angle = snapConduitAngle(init?.angle);
    for (let i = 0; i < CONDUIT_MAX_LANES; i++) {
      // `trueany` in, the supremum; a fresh MutableSocket out per
      // lane so the lane carries its adopted type on.
      this.addInput(conduitInKey(i), new ClassicPreset.Input(trueAnySocket));
      this.addOutput(conduitOutKey(i), new ClassicPreset.Output(new MutableSocket("trueany")));
    }
  }

  rotateBy(steps: number) {
    this.angle = snapConduitAngle(this.angle + steps * 45);
  }

  setSeq(n: number) {
    const derived = this.label === `Conduit ${this.seq}`;
    this.seq = claimSeq(n);
    if (derived) this.label = `Conduit ${this.seq}`;
  }

  /** A pasted clone carries `seq`, which must not duplicate. */
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
