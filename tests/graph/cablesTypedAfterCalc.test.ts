// [[C136]] typesKnownAfterCalc, [[socket-lattice#Requirements]]
// Once a calculation has run, a cable that carries a value has a type at both ends: no output that holds an answer
// stays untyped, and neither does the input it feeds. Run over every example as shipped.
import { describe, it, expect, afterEach } from "vitest";
import type { View } from "../../src/graph/view";
import { GraphEditor } from "../../src/graph/graphEditor";
import { GraphConnection, GraphNode } from "../../src/graph/graphModel";
import { DataflowEngine } from "../../src/graph/dataflowEngine";
import * as Nodes from "../../src/graph/nodeClasses";
import type { Schemes } from "../../src/graph/schemes";
import { processGraph, setEditorRefs } from "../../src/graph/process";
import { isSolError } from "../../src/graph/errorValue";
import { SEEDS } from "../../src/graph/seeds";
import { reconcileFcTypes } from "../../src/graph/fcReconcile";

/** Seeds this loop leaves out, as `seedsCompute.test.ts` does and for its reasons. */
const SKIPPED = new Set(["null-and-logical", "composite-workbench", "garden-dashboard"]);

/** Cards this loop leaves to their own tests: each is typed by a system of its own that a bare editor does not run. */
const TYPED_ELSEWHERE: Record<string, string> = {
  NaNode: "its output is the #N/A error itself, which has no type to show",
  FormatControllerNode: "typed by the dock a load makes (fcReconcile; formatControllerAdopt and fcReconcile tests)",
  ConduitNode: "lanes are typed by tracing each to its source (conduitTrace tests)",
  CompositeNode: "boundary ports are typed by the composite's own sync pass",
  CompositeInputNode: "a boundary marker, typed by the composite's sync pass",
  CompositeOutputNode: "a boundary marker, typed by the composite's sync pass",
};

type SavedNode = { id: string; type: string; init?: Record<string, unknown>; literals?: Record<string, number>; stringLiterals?: Record<string, string> };
type SavedConn = { source: string; sourceOutput: string; target: string; targetInput: string };

const typeOf = (port: { socket?: unknown } | undefined): string | undefined => (port?.socket as { dataType?: string } | undefined)?.dataType;
/** Something a type can be read off: not blank, not an error, not an empty list. */
const carries = (v: unknown): boolean => v !== null && v !== undefined && !isSolError(v) && !(Array.isArray(v) && v.length === 0);

// A Format Controller's retype redraws its cables on the next frame; there are no frames here.
(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame ??= (fn: () => void) => { fn(); return 0; };

describe("[[C136]] a cable that carries a value is typed at both ends once the calculation has run", () => {
  afterEach(() => setEditorRefs(null as never, null as never, null as never));

  for (const [id, seed] of Object.entries(SEEDS)) {
    const graph = seed.graph as unknown as { nodes: SavedNode[]; connections: SavedConn[] };
    if (!Array.isArray(graph.nodes) || SKIPPED.has(id)) continue;

    it(`seed ${id}`, async () => {
      const editor = new GraphEditor<Schemes>();
      const engine = new DataflowEngine<Schemes>();
      editor.use(engine);
      const view = { rerenderNode: async () => {}, rerenderCables: async () => {} } as unknown as View;
      setEditorRefs(editor, engine, view);
      const byId = new Map<string, GraphNode>();
      for (const sn of graph.nodes) {
        const Ctor = (Nodes as unknown as Record<string, new (i?: Record<string, unknown>) => GraphNode>)[sn.type];
        if (typeof Ctor !== "function") continue;
        const node = new Ctor({ ...sn.init });
        const anyNode = node as unknown as Record<string, unknown>;
        if (sn.literals) anyNode.literals = { ...sn.literals };
        if (sn.stringLiterals) anyNode.stringLiterals = { ...sn.stringLiterals };
        byId.set(sn.id, node);
        await editor.addNode(node as unknown as Schemes["Node"]);
      }
      const cables: { c: SavedConn; s: GraphNode; t: GraphNode }[] = [];
      for (const c of graph.connections) {
        const s = byId.get(c.source), t = byId.get(c.target);
        if (!s || !t) continue;
        try {
          await editor.addConnection(new GraphConnection(s, c.sourceOutput, t, c.targetInput) as Schemes["Connection"]);
          cables.push({ c, s, t });
        } catch { /* seeds.test.ts reports a pair the lattice refuses */ }
      }
      // As a load does: the wiring's types settle and each Format Controller takes its input's, the pass runs, and
      // the types the values gave settle again.
      await reconcileFcTypes(editor as never, view);
      await processGraph();
      await reconcileFcTypes(editor as never, view);
      await processGraph();

      const untyped: string[] = [];
      for (const { c, s, t } of cables) {
        if (s.constructor.name in TYPED_ELSEWHERE || t.constructor.name in TYPED_ELSEWHERE) continue;
        let value: unknown;
        try { value = ((await engine.fetch(s.id)) as Record<string, unknown>)[c.sourceOutput]; } catch { continue; }
        if (!carries(value)) continue;
        const out = typeOf(s.outputs[c.sourceOutput]), inp = typeOf(t.inputs[c.targetInput]);
        if (out === "trueany") untyped.push(`${s.constructor.name} ${c.source}.${c.sourceOutput} (output)`);
        if (inp === "trueany") untyped.push(`${t.constructor.name} ${c.target}.${c.targetInput} (input, fed by ${s.constructor.name} ${typeOf(s.outputs[c.sourceOutput])})`);
      }
      expect([...new Set(untyped)], "cables carrying a value with an untyped end").toEqual([]);
    }, 60_000);
  }
});
