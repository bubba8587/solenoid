import { describe, it } from "vitest";
import { readFileSync } from "node:fs";
import { ClassicPreset, NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import * as Nodes from "./rete-nodes";
import type { Schemes } from "./schemes";
import { installInputCoercion } from "./coerceInputs";
import { installErrorGuards, solError } from "./errorValue";
import { loopMembers } from "./graphCompute";
import { csvToFrame } from "./nodes/connection";
import { connectionStore } from "./connectionStore";
import seed from "./seedGraphs/personal-finance.json";

// ─── Headless COMPUTE benchmark ──────────────────────────────────────────────────
// Measures ONLY the compute phase of processGraph — engine.reset() + a fetch of
// every node — which is what a slider drag / input edit re-runs from scratch each
// tick (no dirty-tracking). It does NOT measure the render phase (cableValueStore
// .bump + area.update + React reconcile + cable re-route), which needs a real DOM
// and is the in-app `window.__solenoidPerf` probe's job. Pan/zoom cost is render-
// only and not exercised here at all.
//
// Run:  npx vitest run src/graph/perfScaling.test.ts
// The graph is duplicated into N disconnected copies (scale 1/2/4) to see whether
// compute scales linearly with TOTAL node count (the "whole graph recomputes"
// hypothesis) — and to project where it crosses a 16ms frame budget.

type SavedNode = {
  id: string; type: string;
  init?: Record<string, unknown>;
  literals?: Record<string, number>;
  stringLiterals?: Record<string, string>;
};
type AnyNode = ClassicPreset.Node & {
  outputs: Record<string, unknown>;
  cachedResult?: unknown;
  lastKey?: string;
  url?: string;
};

// The seed's WebSource urls map 1:1 to the local CSVs pfSeedCheck.test.ts reads.
const csvCache = new Map<string, ReturnType<typeof csvToFrame>>();
function frameForUrl(url: string) {
  const u = url.trim();
  if (!csvCache.has(u)) {
    const text = readFileSync(`public${u}`, "utf8");
    csvCache.set(u, csvToFrame(text));
  }
  return csvCache.get(u)!;
}

const NodeCtors = Nodes as unknown as Record<string, new (i?: Record<string, unknown>) => AnyNode>;

/** Build the personal-finance graph `copies` times into one editor as disconnected
 *  islands. WebSource nodes are pre-seeded from the local CSV so data() returns the
 *  real frame synchronously (no network in a headless run). */
async function buildGraph(copies: number) {
  const editor = new NodeEditor<Schemes>();
  installInputCoercion(editor);
  editor.addPipe((ctx) => {
    if (ctx.type === "nodecreated") installErrorGuards(ctx.data);
    return ctx;
  });
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);

  for (let c = 0; c < copies; c++) {
    const byId = new Map<string, AnyNode>();
    for (const sn of seed.nodes as SavedNode[]) {
      const Ctor = NodeCtors[sn.type];
      if (!Ctor) throw new Error(`unknown node type ${sn.type}`);
      const node = new Ctor({ ...sn.init });
      const anyNode = node as unknown as Record<string, unknown>;
      if (sn.literals) anyNode.literals = { ...sn.literals };
      if (sn.stringLiterals) anyNode.stringLiterals = { ...sn.stringLiterals };
      if (sn.type === "WebSourceNode" && typeof node.url === "string") {
        node.cachedResult = frameForUrl(node.url);
        node.lastKey = connectionStore.key(node.id, node.url.trim());
      }
      byId.set(sn.id, node);
      await editor.addNode(node as unknown as Schemes["Node"]);
    }
    for (const cn of seed.connections) {
      const s = byId.get(cn.source), t = byId.get(cn.target);
      if (!s || !t) continue;
      await editor.addConnection(
        new ClassicPreset.Connection(s, cn.sourceOutput, t, cn.targetInput) as Schemes["Connection"],
      );
    }
  }

  // processGraph's cycle handling, so a loop (none in this seed, but stay faithful)
  // wouldn't deadlock the pull engine.
  const circ = solError("#CIRC!", "loop");
  for (const id of loopMembers(editor)) {
    const node = editor.getNode(id) as unknown as AnyNode;
    const outs: Record<string, unknown> = {};
    for (const k of Object.keys(node.outputs)) outs[k] = circ;
    engine.cache.add(id, Object.assign(Promise.resolve(outs), { cancel() {} }));
  }
  return { editor, engine };
}

/** One compute tick: exactly what processGraph does before it renders. */
async function computeTick(editor: NodeEditor<Schemes>, engine: DataflowEngine<Schemes>) {
  engine.reset();
  for (const node of editor.getNodes()) {
    await engine.fetch(node.id);
  }
}

function stats(samples: number[]) {
  const s = [...samples].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { min: s[0], median: q(0.5), mean: sum / s.length, p95: q(0.95), max: s[s.length - 1] };
}

// Benchmark, not a pass/fail test — 30 iters at 1x/2x/4x is slow and prints a table
// nobody reads in a normal `npm test`. Gate it behind PERF so the default suite stays
// fast; run with `PERF=1 npx vitest run src/graph/perfScaling.test.ts` when profiling.
describe.runIf(!!process.env.PERF)("personal-finance compute scaling", () => {
  it("times engine.reset + fetch-all at 1x / 2x / 4x node count", async () => {
    const WARMUP = 3;
    const ITERS = 30;
    const rows: string[] = [];
    rows.push("scale  nodes  conns   min    median   mean    p95     max    ms/node");
    for (const copies of [1, 2, 4]) {
      const { editor, engine } = await buildGraph(copies);
      const nodes = editor.getNodes().length;
      const conns = editor.getConnections().length;
      for (let i = 0; i < WARMUP; i++) await computeTick(editor, engine);
      const samples: number[] = [];
      for (let i = 0; i < ITERS; i++) {
        const t0 = performance.now();
        await computeTick(editor, engine);
        samples.push(performance.now() - t0);
      }
      const r = stats(samples);
      const f = (n: number) => n.toFixed(2).padStart(6);
      rows.push(
        `${copies}x`.padEnd(5) +
        `${nodes}`.padStart(6) + `${conns}`.padStart(7) +
        f(r.min) + f(r.median) + f(r.mean) + f(r.p95) + f(r.max) +
        `   ${(r.median / nodes).toFixed(3)}`,
      );
    }
    // eslint-disable-next-line no-console
    console.log("\n[perf] compute phase (engine.reset + fetch-all), ms over " +
      `${ITERS} iters after ${WARMUP} warmup:\n` + rows.join("\n") + "\n");
  });
});
