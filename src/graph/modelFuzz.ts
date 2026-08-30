// Model fuzzing: valid-shaped inputs per typed leaf source, driven through the targeted
// recompute path; findings land in the Problems panel (problemsStore, origin "fuzz").
import { ClassicPreset } from "rete";
import { getEditor, getView, processGraph, beginGraphRebuild, endGraphRebuild } from "./process";
import { downstreamClosure } from "./graphCompute";
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

// Deterministic PRNG — a fixed seed makes a run reproducible, which is what makes a
// "no findings" result trustworthy.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Never fuzzes the TYPE — every sample is a finite number a user could plausibly type. */
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

/** A bad SCALAR cell: a tagged error, or a leaked NaN/Infinity (guardFinite means a
 *  computation never yields a bare non-finite). `null` is first-class MISSING, never
 *  a defect. */
function scalarBad(v: unknown): Badness | null {
  if (isSolError(v)) return { code: v.code, message: v.message };
  if (typeof v === "number") {
    if (Number.isNaN(v)) return { code: "#VALUE!", message: "A NaN leaked into this node's result." };
    if (!Number.isFinite(v)) return { code: "#OVERFLOW!", message: "An infinite value leaked into this node's result." };
  }
  return null;
}

/** Uses the SAME bounded head-plus-stride cap as errorValue's per-cell scan — this runs
 *  on every downstream node, every sample. */
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

/** Checked generically so this needs no per-node-class branch list. */
const CACHE_FIELDS = ["cachedResult", "cachedValue", "cachedString", "cachedText", "cachedList", "cachedMatrix", "cachedHeaders"] as const;

function inspectNode(node: unknown): Badness | null {
  // An Expect node REJECTING a synthetic extreme isn't a model defect — the fuzzer feeds
  // the very out-of-range values Expect exists to catch, so a finding here is circular.
  if (node instanceof ExpectNode) return null;
  const n = node as Record<string, unknown>;
  for (const field of CACHE_FIELDS) {
    const hit = badValue(n[field]);
    if (hit) return hit;
  }
  return null;
}

// Codes a min/max bound can plausibly fix; structural failures (#REF!/#SHAPE!/#NAME?/
// #SYNTAX!) aren't mechanical in this sense.
const CLAMPABLE_CODES: ReadonlySet<SolErrorCode> = new Set(["#VALUE!", "#OVERFLOW!", "#DOMAIN!", "#DIV/0!", "#CONV!"]);

/** The plausible splice point for a Clamp; undefined when nothing numeric is wired. */
function firstNumericInput(node: unknown): { socketKey: string; label: string } | undefined {
  const inputs = (node as { inputs?: Record<string, { socket?: unknown; label?: string }> }).inputs ?? {};
  for (const [key, port] of Object.entries(inputs)) {
    const dt = port?.socket instanceof SolenoidSocket ? port.socket.dataType : undefined;
    if (dt === "number" || dt === "numlist") return { socketKey: key, label: port?.label ?? key };
  }
  return undefined;
}

// The [min, max] arriving on a node's clamp-target input across every CLEAN sample.
// Heuristic: a Clamp imposes only min/max, so it can't exclude an interior bad point.
interface SafeRange { min: number; max: number }

/** Which input to splice onto, plus the bounds to seed the Clamp with when the sweep
 *  captured a safe range. */
export interface ClampSuggestion { socketKey: string; label: string; min?: number; max?: number }

/** Bounded by the same head-plus-stride cap as the error scan — a source can output
 *  a big list. */
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

/** Read from the node's cache (or a source's `.value`) to observe what flows into a
 *  downstream node's clamp-target input. */
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

/** Only a NON-DEGENERATE finite range yields bounds: a single-point range would pin
 *  the value and break the model. */
export function boundsFromSafeRange(range: SafeRange | undefined): { min: number; max: number } | undefined {
  if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max) || range.min >= range.max) return undefined;
  return { min: range.min, max: range.max };
}

export interface FuzzRunSummary {
  leaves: number;
  samples: number;
  findings: number;
}

/** Perturb every leaf source through a batch of samples, scan the downstream cone after
 *  each, restore the original value, and publish deduped findings. */
export async function runModelFuzz(): Promise<FuzzRunSummary> {
  const editor = getEditor();
  if (!editor) return { leaves: 0, samples: 0, findings: 0 };
  const leaves = findLeaves(editor);
  const rng = mulberry32(0x5EED_F022);
  const found = new Map<string, { nodeId: string; code: SolErrorCode; message: string; suggestion?: ClampSuggestion }>();
  // Per-node observed-safe input range, accumulated across every clean sample.
  const safeRanges = new Map<string, SafeRange>();
  // (target::input) → the source feeding it; connections don't change mid-sweep.
  const inputSource = new Map<string, string>();
  for (const c of editor.getConnections()) inputSource.set(`${c.target}::${c.targetInput}`, c.source);
  let samples = 0;

  // processGraph brackets itself, but those fast sub-passes drop the counter to 0 between
  // samples and cancel the deferred reveal; an outer bracket keeps the curtain up.
  beginCompute();
  // The rebuild gate does two jobs: the manual-calc short-circuit exempts rebuilds (so a
  // sampled recompute RUNS in manual mode), and AlertNode/Expect suppress their edge-detect
  // fire (so a synthetic sample can't raise a real alert).
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
        // Restore on EVERY exit path — a throw must not leave the graph holding a sample.
        (leaf.node as { value: number | string }).value = original;
        await processGraph(leaf.node.id);
      }
    }
  } finally {
    endGraphRebuild();
    endCompute();
  }

  const findings = [...found.values()].map((f) => {
    if (!f.suggestion) return f;
    const b = boundsFromSafeRange(safeRanges.get(f.nodeId));
    return b ? { ...f, suggestion: { ...f.suggestion, ...b } } : f;
  });
  problemsStore.setFuzzFindings(findings);
  return { leaves: leaves.length, samples, findings: findings.length };
}

/** Splice a Clamp onto the cable feeding `nodeId`'s `socketKey` input; no-op if unwired.
 *  `bounds` seeds its literals so the Clamp arrives CONFIGURED, not as a pass-through. */
export async function insertClampBefore(
  nodeId: string,
  socketKey: string,
  bounds?: { min?: number; max?: number },
): Promise<boolean> {
  const editor = getEditor();
  const view = getView();
  if (!editor || !view) return false;
  const target = editor.getNode(nodeId);
  if (!target) return false;
  const conn = editor.getConnections().find((c) => c.target === nodeId && c.targetInput === socketKey);
  if (!conn) return false;
  const source = editor.getNode(conn.source);
  if (!source) return false;

  const clamp = new ClampNode({ label: "Clamp" });
  // An unwired min/max input reads its literal, so this makes the splice active.
  if (typeof bounds?.min === "number") clamp.literals.min = bounds.min;
  if (typeof bounds?.max === "number") clamp.literals.max = bounds.max;
  await editor.addNode(clamp);
  const srcPos = view.position(conn.source) ?? { x: 0, y: 0 };
  const tgtPos = view.position(nodeId) ?? { x: 0, y: 0 };
  await view.moveNode(clamp.id, { x: (srcPos.x + tgtPos.x) / 2, y: (srcPos.y + tgtPos.y) / 2 - 60 });

  await editor.removeConnection(conn.id);
  await editor.addConnection(new ClassicPreset.Connection(source, conn.sourceOutput, clamp, "value") as SolenoidConnection);
  await editor.addConnection(new ClassicPreset.Connection(clamp, "result", target, socketKey) as SolenoidConnection);
  await processGraph();
  return true;
}
