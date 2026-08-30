import { describe, it, expect } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import * as Nodes from "../../src/graph/rete-nodes";
import type { Schemes } from "../../src/graph/schemes";
import { installInputCoercion } from "../../src/graph/coerceInputs";
import { installErrorGuards } from "../../src/graph/errorValue";
import { CompositeNode } from "../../src/graph/nodes/composite";
import { ctorRegistry } from "../../src/graph/nodeCtorRegistry";
import seed from "../../src/graph/seedGraphs/sudoku-solver.json";

// Runs the Sudoku Solver seed end-to-end: the Simulation container iterates a
// pure matrix-algebra deduction round (naked singles + hidden singles + naked
// pairs over an 81×9 candidate matrix) to a fixpoint, and the output ports
// carry the finished 9×9 grid. The puzzle is hard enough that singles alone
// stall — the naked-pair stage is load-bearing, so a regression in any of the
// three techniques fails the exact-solution assertion.

type SavedNode = {
  id: string; type: string;
  init?: Record<string, unknown>;
  literals?: Record<string, number>;
  stringLiterals?: Record<string, string>;
};

// The puzzle's unique solution (independently verified by exhaustive search).
const SOLUTION = [
  [6, 2, 1, 3, 5, 7, 8, 4, 9],
  [8, 9, 4, 2, 1, 6, 5, 3, 7],
  [5, 7, 3, 9, 8, 4, 2, 6, 1],
  [1, 6, 5, 8, 3, 9, 4, 7, 2],
  [2, 3, 9, 7, 4, 1, 6, 8, 5],
  [4, 8, 7, 6, 2, 5, 9, 1, 3],
  [3, 5, 8, 1, 6, 2, 7, 9, 4],
  [7, 4, 6, 5, 9, 3, 1, 2, 8],
  [9, 1, 2, 4, 7, 8, 3, 5, 6],
];

function buildEditor() {
  const editor = new NodeEditor<Schemes>();
  installInputCoercion(editor);
  editor.addPipe((ctx) => { if (ctx.type === "nodecreated") installErrorGuards(ctx.data); return ctx; });
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  return { editor, engine };
}

async function loadSeed(editor: NodeEditor<Schemes>) {
  const byId = new Map<string, ClassicPreset.Node>();
  for (const sn of (seed.nodes as SavedNode[])) {
    const Ctor = (Nodes as unknown as Record<string, new (i?: Record<string, unknown>) => ClassicPreset.Node>)[sn.type];
    expect(Ctor, `unknown type ${sn.type}`).toBeTypeOf("function");
    const node = new Ctor({ ...sn.init });
    const anyNode = node as unknown as Record<string, unknown>;
    if (sn.literals) anyNode.literals = { ...sn.literals };
    if (sn.stringLiterals) anyNode.stringLiterals = { ...sn.stringLiterals };
    if (node instanceof CompositeNode) await node.hydrate(ctorRegistry());
    byId.set(sn.id, node);
    await editor.addNode(node as unknown as Schemes["Node"]);
  }
  for (const c of seed.connections) {
    await editor.addConnection(
      new ClassicPreset.Connection(byId.get(c.source)!, c.sourceOutput, byId.get(c.target)!, c.targetInput) as Schemes["Connection"],
    );
  }
  return byId;
}

describe("Sudoku Solver seed", () => {
  it("solves the seed puzzle exactly and reports Solved", async () => {
    const { editor, engine } = buildEditor();
    const byId = await loadSeed(editor);
    const out = await engine.fetch(byId.get("solver")!.id) as Record<string, unknown>;
    expect(out.p_solved).toBe(true);
    expect(out.p_solution).toEqual(SOLUTION);
  });
});
