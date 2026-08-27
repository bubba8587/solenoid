import { describe, it, expect } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import * as Nodes from "./rete-nodes";
import type { Schemes } from "./schemes";
import { installInputCoercion } from "./coerceInputs";
import { installErrorGuards, isSolError } from "./errorValue";
import { SEEDS } from "./seeds";

// Every seed, run through a real editor + DataflowEngine: no node may compute an
// error the seed did not set out to show. `seeds.test.ts` checks a seed's SHAPE —
// types construct, literals land on declaring classes, connections land on
// compatible sockets — all of which a seed passes while still coming up red in the
// app. That is exactly how power-features shipped a MAP whose wired lambda declared
// `x`, a name MAP does not bind (lambdaBindsByName: its variables are
// value/value2/value3/row/col, and an unknown param is #VALUE!).
//
// Exemptions are per NODE and matched EXACTLY, never per seed: a blanket seed pass
// would hide the next accidental error sitting next to a deliberate one, and an
// exact match also fails when a demo STOPS erroring, so the list can't rot either way.

/** Node ids each seed means to compute an error, and what the error demonstrates. */
const EXPECTED_ERRORS: Record<string, string[]> = {
  // The dimension-mismatch demo: a currency value into a Convert targeting metres.
  // H_conv2 raises #UNIT!, H_d2 is the Display showing it off (its label says so).
  "unit-flow": ["H_conv2", "H_d2"],
};

/** Seeds this loop can't fetch, each owned by a test that can. */
const SKIPPED: Record<string, string> = {
  "null-and-logical":
    "the error-codes tour, incl. a #CIRC! loop — errorSeed.test.ts runs it with the cycle cache-seeding a plain fetch loop lacks",
  "composite-workbench":
    "7 composites on goal-seek / 500-sample Monte Carlo / data-table run modes; minutes here, and a bare constructor never hydrates their internal graphs",
};

type SavedNode = {
  id: string; type: string;
  init?: Record<string, unknown>;
  literals?: Record<string, number>;
  stringLiterals?: Record<string, string>;
};
type SavedConn = { source: string; sourceOutput: string; target: string; targetInput: string };

async function buildSeed(graph: { nodes: SavedNode[]; connections: SavedConn[] }) {
  const editor = new NodeEditor<Schemes>();
  installInputCoercion(editor);
  editor.addPipe((ctx) => { if (ctx.type === "nodecreated") installErrorGuards(ctx.data); return ctx; });
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);

  const byId = new Map<string, ClassicPreset.Node>();
  for (const sn of graph.nodes) {
    const Ctor = (Nodes as unknown as Record<string, new (i?: Record<string, unknown>) => ClassicPreset.Node>)[sn.type];
    if (typeof Ctor !== "function") continue;   // seeds.test.ts owns "every type constructs"
    const node = new Ctor({ ...sn.init });
    const anyNode = node as unknown as Record<string, unknown>;
    if (sn.literals) anyNode.literals = { ...sn.literals };
    if (sn.stringLiterals) anyNode.stringLiterals = { ...sn.stringLiterals };
    byId.set(sn.id, node);
    await editor.addNode(node as unknown as Schemes["Node"]);
  }
  for (const c of graph.connections) {
    const s = byId.get(c.source);
    const t = byId.get(c.target);
    if (!s || !t) continue;                     // seeds.test.ts owns connection validity
    try {
      await editor.addConnection(
        new ClassicPreset.Connection(s, c.sourceOutput, t, c.targetInput) as Schemes["Connection"],
      );
    } catch { /* incompatible pair — seeds.test.ts reports it with better detail */ }
  }
  return { engine, byId };
}

for (const [id, seed] of Object.entries(SEEDS)) {
  const graph = seed.graph as unknown as { nodes: SavedNode[]; connections: SavedConn[] };
  if (!Array.isArray(graph.nodes)) continue;
  const expected = EXPECTED_ERRORS[id] ?? [];

  describe(`seed ${id}`, () => {
    const name = SKIPPED[id]
      ? `computes — SKIPPED (${SKIPPED[id]})`
      : expected.length
        ? `computes errors only where it means to (${expected.join(", ")})`
        : "computes with no errors";
    (SKIPPED[id] ? it.skip : it)(name, async () => {
      const { engine, byId } = await buildSeed(graph);
      const detail: string[] = [];
      const red = new Set<string>();
      for (const sn of graph.nodes) {
        const node = byId.get(sn.id);
        if (!node) continue;
        let out: Record<string, unknown>;
        try {
          out = (await engine.fetch(node.id)) as Record<string, unknown>;
        } catch {
          // A live-data node (fetch, file read) can't resolve offline; a real compute
          // failure comes back through the guards as a SolError, which the scan sees.
          continue;
        }
        for (const [key, v] of Object.entries(out ?? {})) {
          if (!isSolError(v)) continue;
          red.add(sn.id);
          const label = (sn.init?.label as string | undefined) ?? sn.type;
          detail.push(`${sn.id} (${sn.type} "${label}") .${key} → ${v.code}: ${v.message ?? ""}`);
        }
      }
      expect(
        [...red].sort(),
        detail.length
          ? `seed "${id}" computes:\n  ${detail.join("\n  ")}`
          : `seed "${id}" computes no errors, but ${expected.join(", ")} is listed as a demo`,
      ).toEqual([...expected].sort());
    }, 60_000);
  });
}
