// Model fuzzing: property-based testing for the graph. Generates hundreds of
// valid-shaped inputs per typed leaf (Number/Slider/Text sources), drives each
// through the existing targeted-recompute path (processGraph(changedNodeId)),
// and scans the downstream cone for what breaks: a tagged SolError, a leaked
// NaN/Infinity, or a failing Expect node (#12). Findings land in the Problems
// panel (problemsStore, origin "fuzz") — a mechanical numeric-domain finding
// carries a one-click "insert Clamp" suggestion (insertClampBefore below),
// since there's no existing mid-cable node-insertion primitive to reuse yet
// (bundle 14 "quick-wire" is future work) — this builds the minimal splice
// itself: remove the cable, drop a Clamp between source and target.
import { ClassicPreset } from "rete";
import { getEditor, getArea, processGraph, downstreamClosure, beginGraphRebuild, endGraphRebuild } from "./process";
import { beginCompute, endCompute } from "./computeOverlayStore";
import { NumberInputNode, SliderInputNode } from "./nodes/input";
import { TextInputNode } from "./nodes/text";
import { ClampNode } from "./nodes/scalar";
import { ExpectNode } from "./nodes/quality";
import { isSolError, isFrameLike, sampledCellIndices, type SolErrorCode } from "./errorValue";
import { problemsStore } from "./problemsStore";
import { SolenoidSocket } from "./sockets";
import type { SolenoidConnection } from "./schemes";

type AnyEditor = NonNullable<ReturnType<typeof getEditor>>;

const SAMPLES_PER_LEAF = 120;

// Deterministic, dependency-free PRNG (mulberry32) — a fixed seed makes a run
// reproducible (same graph, same findings), which matters for trusting a "no
// findings" result.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Valid-shaped numeric samples: boundary values plus a spread of magnitudes
 *  and signs, so an edge case (0, a tiny divisor, a huge magnitude) is covered
 *  alongside ordinary values — not fuzzing the TYPE (still real finite numbers),
 *  just the range a user could plausibly type. */
function sampleNumbers(rng: () => number, n: number): number[] {
  const out = [0, 1, -1, 0.0001, -0.0001, 100, -100, 1e6, -1e6, 1e-8];
  while (out.length < n) {
    const magnitude = Math.pow(10, rng() * 8 - 2); // ~0.01 .. ~1e6
    const sign = rng() < 0.5 ? -1 : 1;
    out.push(sign * magnitude * (0.1 + rng() * 0.9));
  }
  return out.slice(0, n);
}

const SAMPLE_WORDS = ["", " ", "a", "hello world", "0", "-1", "3.14", "TRUE", "𝛑✓😀", "a".repeat(200), "  padded  ", "line1\nline2", "50%", "1,234.56"];
function sampleStrings(rng: () => number, n: number): string[] {
  const out = [...SAMPLE_WORDS];
  while (out.length < n) {
    const len = 1 + Math.floor(rng() * 24);
    let s = "";
    for (let i = 0; i < len; i++) s += String.fromCharCode(32 + Math.floor(rng() * 94));
    out.push(s);
  }
  return out.slice(0, n);
}

type Leaf =
  | { kind: "number"; node: NumberInputNode | SliderInputNode }
  | { kind: "text"; node: TextInputNode };

function findLeaves(editor: AnyEditor): Leaf[] {
  const leaves: Leaf[] = [];
  for (const node of editor.getNodes()) {
    const hasInputs = Object.keys((node as unknown as { inputs?: Record<string, unknown> }).inputs ?? {}).length > 0;
    if (hasInputs) continue;
    if (node instanceof NumberInputNode || node instanceof SliderInputNode) leaves.push({ kind: "number", node });
    else if (node instanceof TextInputNode) leaves.push({ kind: "text", node });
  }
  return leaves;
}

interface Badness { code: SolErrorCode; message: string }

/** A bad SCALAR cell: a tagged error, or a leaked NaN/Infinity (per the
 *  guardFinite model a computation never yields a bare non-finite, so one is
 *  dirty data worth flagging). Nulls are NOT flagged — a `null` is a first-class
 *  MISSING value, legitimate inside any list/frame, so treating it as a defect
 *  would be pure noise (see valueKinds.ts). */
function scalarBad(v: unknown): Badness | null {
  if (isSolError(v)) return { code: v.code, message: v.message };
  if (typeof v === "number") {
    if (Number.isNaN(v)) return { code: "#VALUE!", message: "A NaN leaked into this node's result." };
    if (!Number.isFinite(v)) return { code: "#OVERFLOW!", message: "An infinite value leaked into this node's result." };
  }
  return null;
}

/** Scan a value (scalar, list, matrix, or frame) for the first bad cell, using
 *  the SAME bounded head-plus-stride cap as errorValue's per-cell scan — a full
 *  per-cell scan was rejected on perf, and the fuzzer runs this on every
 *  downstream node after every one of hundreds of samples. So a per-cell error
 *  now surfaces (previously only top-level did), without the O(rows×cols) cost. */
function badValue(v: unknown): Badness | null {
  const s = scalarBad(v);
  if (s) return s;
  if (Array.isArray(v)) {
    for (const i of sampledCellIndices(v.length)) {
      const hit = badValue(v[i]); // recurse for matrix rows (same per-row bound)
      if (hit) return hit;
    }
    return null;
  }
  if (isFrameLike(v)) {
    for (const col of v.columns) {
      for (const i of sampledCellIndices(col.values.length)) {
        const hit = scalarBad(col.values[i]);
        if (hit) return hit;
      }
    }
  }
  return null;
}

/** Every cache field a node component might read — checked generically so this
 *  doesn't need a per-node-class branch list. */
const CACHE_FIELDS = ["cachedResult", "cachedValue", "cachedString", "cachedText", "cachedList", "cachedMatrix", "cachedHeaders"] as const;

function inspectNode(node: unknown): Badness | null {
  // An Expect node REJECTING a synthetic extreme isn't a model defect — the fuzzer
  // feeds the very out-of-range values Expect exists to catch (±1e6, …), so treating
  // its violation as a finding is guaranteed, circular noise. Skip Expect entirely;
  // it's a validator, not a computation whose output can be "bad".
  if (node instanceof ExpectNode) return null;
  const n = node as Record<string, unknown>;
  for (const field of CACHE_FIELDS) {
    const hit = badValue(n[field]);
    if (hit) return hit;
  }
  return null;
}

// Codes worth offering a Clamp for — a numeric-domain problem a min/max bound
// can plausibly fix. Structural failures (#REF!/#SHAPE!/#NAME?/#SYNTAX!) aren't
// mechanical in this sense — clamping a range doesn't fix a missing column.
const CLAMPABLE_CODES: ReadonlySet<SolErrorCode> = new Set(["#VALUE!", "#OVERFLOW!", "#DOMAIN!", "#DIV/0!", "#CONV!"]);

/** The first numeric (number/numlist) WIRED input on a node — the plausible
 *  splice point for a Clamp. Undefined when there's nothing numeric to clamp. */
function firstNumericInput(node: unknown): { socketKey: string; label: string } | undefined {
  const inputs = (node as { inputs?: Record<string, { socket?: unknown; label?: string }> }).inputs ?? {};
  for (const [key, port] of Object.entries(inputs)) {
    const dt = port?.socket instanceof SolenoidSocket ? port.socket.dataType : undefined;
    if (dt === "number" || dt === "numlist") return { socketKey: key, label: port?.label ?? key };
  }
  return undefined;
}

// ─── Safe-range capture (Clamp seeding) ───────────────────────────────────────
// To seed the "+ Clamp" fix with real bounds instead of an unconfigured
// pass-through, we observe the value ARRIVING on a node's clamp-target input on
// every CLEAN sample (the node didn't go bad) and track its [min, max]. Seeding
// the Clamp with that observed-safe range keeps future values inside the
// territory the sweep never saw fail. Heuristic, and inherently limited to
// EXTREME-bound problems (a Clamp imposes only min/max, so it can't exclude an
// interior bad point like a divisor of 0 — for #DIV/0! the seeded range still
// spans 0); it genuinely helps the magnitude cases (#OVERFLOW!, a domain miss at
// a large/small input).
interface SafeRange { min: number; max: number }

/** A "+ Clamp" suggestion: which input to splice onto, plus (when the sweep
 *  captured a safe range) the bounds to seed the Clamp with. */
export interface ClampSuggestion { socketKey: string; label: string; min?: number; max?: number }

/** Finite numbers reachable in a value (scalar/list/matrix), bounded by the same
 *  head-plus-stride cap as the error scan — the source could output a big list. */
export function collectFinite(v: unknown): number[] {
  if (typeof v === "number") return Number.isFinite(v) ? [v] : [];
  if (Array.isArray(v)) {
    const out: number[] = [];
    for (const i of sampledCellIndices(v.length)) {
      const cell = v[i];
      if (typeof cell === "number" && Number.isFinite(cell)) out.push(cell);
      else if (Array.isArray(cell)) {
        for (const j of sampledCellIndices(cell.length)) {
          const c2 = cell[j];
          if (typeof c2 === "number" && Number.isFinite(c2)) out.push(c2);
        }
      }
    }
    return out;
  }
  return [];
}

/** The numeric value(s) a node is currently outputting — read from its cache
 *  (or a source node's `.value`), used to observe what flows into a downstream
 *  node's clamp-target input. */
function readNumericValues(node: unknown): number[] {
  if (!node) return [];
  const n = node as Record<string, unknown>;
  for (const field of [...CACHE_FIELDS, "value"] as string[]) {
    const nums = collectFinite(n[field]);
    if (nums.length) return nums;
  }
  return [];
}

export function extendSafeRange(acc: Map<string, SafeRange>, nodeId: string, vals: number[]): void {
  let e = acc.get(nodeId);
  if (!e) { e = { min: Infinity, max: -Infinity }; acc.set(nodeId, e); }
  for (const x of vals) { if (x < e.min) e.min = x; if (x > e.max) e.max = x; }
}

/** Turn an accumulated safe range into Clamp bounds — but only a NON-DEGENERATE,
 *  finite range. A single-point range (min === max) would pin the value and
 *  break the model, so it yields no bounds (the Clamp is inserted unconfigured). */
export function boundsFromSafeRange(range: SafeRange | undefined): { min: number; max: number } | undefined {
  if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max) || range.min >= range.max) return undefined;
  return { min: range.min, max: range.max };
}

export interface FuzzRunSummary {
  leaves: number;
  samples: number;
  findings: number;
}

/** Run the fuzz sweep: perturb every leaf Number/Slider/Text source through a
 *  batch of valid-shaped samples, scan the downstream cone after each, restore
 *  the original value, and publish deduped findings to the Problems panel. */
export async function runModelFuzz(): Promise<FuzzRunSummary> {
  const editor = getEditor();
  if (!editor) return { leaves: 0, samples: 0, findings: 0 };
  const leaves = findLeaves(editor);
  const rng = mulberry32(0x5EED_F022);
  const found = new Map<string, { nodeId: string; code: SolErrorCode; message: string; suggestion?: ClampSuggestion }>();
  // Per-node observed-safe input range, accumulated across every clean sample —
  // used at the end to seed a finding's Clamp with real bounds.
  const safeRanges = new Map<string, SafeRange>();
  // (target::input) → the source feeding it, so we can read the value arriving on
  // a downstream node's clamp-target input. Connections don't change mid-sweep.
  const inputSource = new Map<string, string>();
  for (const c of editor.getConnections()) inputSource.set(`${c.target}::${c.targetInput}`, c.source);
  let samples = 0;

  // Hundreds of recompute passes per leaf is irreducibly heavy — show the busy
  // curtain for the whole sweep. Each processGraph() brackets ITSELF with
  // begin/endCompute, but those fast sub-passes drop the counter to 0 between
  // samples and cancel the deferred reveal before it fires; an outer bracket
  // across the entire sweep keeps the counter ≥1 so the 150ms reveal lands and
  // the curtain also BLOCKS interaction during the multi-second run.
  beginCompute();
  // The whole sweep runs inside the graph-rebuild gate, which does two jobs at
  // once: (1) the manual-calc short-circuit exempts rebuilds, so every sampled
  // recompute actually RUNS in manual mode (it otherwise just marked dirty and
  // the sweep inspected stale pre-fuzz values — a silent no-op reported as "no
  // problems found"); (2) AlertNode/Expect suppress their edge-detect fire
  // while rebuilding, so a synthetic sample can't raise a real toast/HUD alert.
  beginGraphRebuild();
  try {
    for (const leaf of leaves) {
      const original = leaf.node.value;
      const downstream = downstreamClosure(editor, leaf.node.id);
      const values = leaf.kind === "number" ? sampleNumbers(rng, SAMPLES_PER_LEAF) : sampleStrings(rng, SAMPLES_PER_LEAF);
      try {
        for (const v of values) {
          samples++;
          (leaf.node as { value: number | string }).value = v;
          await processGraph(leaf.node.id);
          for (const id of downstream) {
            const node = editor.getNode(id);
            if (!node) continue;
            const hit = inspectNode(node);
            const numInput = firstNumericInput(node);
            // On a CLEAN pass, record the value arriving on this node's
            // clamp-target input, so a later finding can seed real bounds.
            if (!hit && numInput) {
              const srcId = inputSource.get(`${id}::${numInput.socketKey}`);
              if (srcId) {
                const vals = readNumericValues(editor.getNode(srcId));
                if (vals.length) extendSafeRange(safeRanges, id, vals);
              }
            }
            if (!hit) continue;
            const key = `${id}:${hit.code}`;
            if (found.has(key)) continue;
            const suggestion = CLAMPABLE_CODES.has(hit.code) ? numInput : undefined;
            found.set(key, { nodeId: id, code: hit.code, message: hit.message, suggestion });
          }
        }
      } finally {
        // Restore on EVERY exit path — a throw mid-sweep must not leave the
        // user's real graph mutated with a synthetic sample.
        (leaf.node as { value: number | string }).value = original;
        await processGraph(leaf.node.id);
      }
    }
  } finally {
    endGraphRebuild();
    endCompute();
  }

  // Seed each clampable finding with the observed-safe [min, max] for its node —
  // but only a non-degenerate range (min < max); a single-point range would pin
  // the value and break the model, so leave those as an unconfigured Clamp.
  const findings = [...found.values()].map((f) => {
    if (!f.suggestion) return f;
    const b = boundsFromSafeRange(safeRanges.get(f.nodeId));
    return b ? { ...f, suggestion: { ...f.suggestion, ...b } } : f;
  });
  problemsStore.setFuzzFindings(findings);
  return { leaves: leaves.length, samples, findings: findings.length };
}

/** The one-click mechanical fix: splice a Clamp node onto the cable feeding
 *  `nodeId`'s `socketKey` input. Built from scratch (add node → remove the old
 *  connection → rewire through the Clamp) since no mid-cable insertion API
 *  exists yet. No-op if the input isn't actually wired (nothing to splice).
 *  `bounds` (from the fuzz finding's captured safe range) seeds the Clamp's
 *  min/max literals so it arrives CONFIGURED, not as a no-op pass-through. */
export async function insertClampBefore(
  nodeId: string,
  socketKey: string,
  bounds?: { min?: number; max?: number },
): Promise<boolean> {
  const editor = getEditor();
  const area = getArea();
  if (!editor || !area) return false;
  const target = editor.getNode(nodeId);
  if (!target) return false;
  const conn = editor.getConnections().find((c) => c.target === nodeId && c.targetInput === socketKey);
  if (!conn) return false;
  const source = editor.getNode(conn.source);
  if (!source) return false;

  const clamp = new ClampNode({ label: "Clamp" });
  // Seed the bounds (each optional — Clamp applies floor/ceiling independently);
  // an unwired min/max input reads its literal, so this makes the splice active.
  if (typeof bounds?.min === "number") clamp.literals.min = bounds.min;
  if (typeof bounds?.max === "number") clamp.literals.max = bounds.max;
  await editor.addNode(clamp);
  const srcPos = area.nodeViews.get(conn.source)?.position ?? { x: 0, y: 0 };
  const tgtPos = area.nodeViews.get(nodeId)?.position ?? { x: 0, y: 0 };
  await area.translate(clamp.id, { x: (srcPos.x + tgtPos.x) / 2, y: (srcPos.y + tgtPos.y) / 2 - 60 });

  await editor.removeConnection(conn.id);
  await editor.addConnection(new ClassicPreset.Connection(source, conn.sourceOutput, clamp, "value") as SolenoidConnection);
  await editor.addConnection(new ClassicPreset.Connection(clamp, "result", target, socketKey) as SolenoidConnection);
  await processGraph();
  return true;
}
