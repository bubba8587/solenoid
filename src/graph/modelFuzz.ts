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
import { NumberInputNode, SliderInputNode } from "./nodes/input";
import { TextInputNode } from "./nodes/text";
import { ClampNode } from "./nodes/scalar";
import { ExpectNode } from "./nodes/quality";
import { isSolError, type SolErrorCode } from "./errorValue";
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

function badValue(v: unknown, depth = 0): Badness | null {
  if (depth > 3) return null;
  if (isSolError(v)) return { code: v.code, message: v.message };
  if (typeof v === "number") {
    if (Number.isNaN(v)) return { code: "#VALUE!", message: "A NaN leaked into this node's result." };
    if (!Number.isFinite(v)) return { code: "#OVERFLOW!", message: "An infinite value leaked into this node's result." };
  }
  if (Array.isArray(v)) {
    for (const el of v) {
      const hit = badValue(el, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

/** Every cache field a node component might read — checked generically so this
 *  doesn't need a per-node-class branch list. */
const CACHE_FIELDS = ["cachedResult", "cachedValue", "cachedString", "cachedText", "cachedList", "cachedMatrix", "cachedHeaders"] as const;

function inspectNode(node: unknown): Badness | null {
  const n = node as Record<string, unknown>;
  for (const field of CACHE_FIELDS) {
    const hit = badValue(n[field]);
    if (hit) return hit;
  }
  if (node instanceof ExpectNode && node.violations.length > 0) {
    return { code: "#VALUE!", message: `An Expect check failed: ${node.violations.join(", ")}.` };
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
  const found = new Map<string, { nodeId: string; code: SolErrorCode; message: string; suggestion?: { socketKey: string; label: string } }>();
  let samples = 0;

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
            if (!hit) continue;
            const key = `${id}:${hit.code}`;
            if (found.has(key)) continue;
            const suggestion = CLAMPABLE_CODES.has(hit.code) ? firstNumericInput(node) : undefined;
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
  }

  const findings = [...found.values()];
  problemsStore.setFuzzFindings(findings);
  return { leaves: leaves.length, samples, findings: findings.length };
}

/** The one-click mechanical fix: splice a Clamp node onto the cable feeding
 *  `nodeId`'s `socketKey` input. Built from scratch (add node → remove the old
 *  connection → rewire through the Clamp) since no mid-cable insertion API
 *  exists yet. No-op if the input isn't actually wired (nothing to splice). */
export async function insertClampBefore(nodeId: string, socketKey: string): Promise<boolean> {
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
