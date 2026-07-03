import { describe, it, expect } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import * as Nodes from "./rete-nodes";
import type { Schemes } from "./schemes";
import { installInputCoercion } from "./coerceInputs";
import { installErrorGuards } from "./errorValue";
import { CompositeNode } from "./nodes/composite";
import { ctorRegistry } from "./nodeCtorRegistry";
import { loopMembers } from "./process";
import seed from "./seedGraphs/composite-workbench.json";

// Runs the Composite Workbench seed through a real editor + DataflowEngine
// (same coercion + error guards as Canvas, same hydrate step as persistence)
// and checks all three sections: the single-run container computes through its
// boundary, the Simulation container resolves its internal feedback loop into
// a bounded series, and the deliberate OUTER loop is recognized as a true
// cycle (the #CIRC! seeding set — the full seeding behavior itself is covered
// by circularReset.test.ts).

type SavedNode = {
  id: string; type: string;
  init?: Record<string, unknown>;
  literals?: Record<string, number>;
  stringLiterals?: Record<string, string>;
};

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
    if (node instanceof CompositeNode) await node.hydrate(ctorRegistry()); // persistence.ts does the same
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

describe("Composite Workbench seed", () => {
  it("single-run container computes price × qty through its boundary", async () => {
    const { editor, engine } = buildEditor();
    const byId = await loadSeed(editor);
    const out = await engine.fetch(byId.get("lineComp")!.id) as Record<string, unknown>;
    expect(out.p_total).toBe(1000); // 250 × 4
  });

  it("simulation container resolves its feedback loop into a per-step series", async () => {
    const { editor, engine } = buildEditor();
    const byId = await loadSeed(editor);
    const out = await engine.fetch(byId.get("simComp")!.id) as Record<string, unknown>;
    const series = out.p_series as number[];
    expect(Array.isArray(series)).toBe(true);
    expect(series).toHaveLength(10);
    // (0 + 100) × 1.05 = 105; (105 + 100) × 1.05 = 215.25; (215.25 + 100) × 1.05 = 331.0125
    expect(series[0]).toBeCloseTo(105);
    expect(series[1]).toBeCloseTo(215.25);
    expect(series[2]).toBeCloseTo(331.0125);
    // Compounding, so strictly increasing throughout.
    for (let i = 1; i < series.length; i++) expect(series[i]).toBeGreaterThan(series[i - 1]);
  });

  it("the open-canvas loop pair is a true cycle (the #CIRC! seeding set)", async () => {
    const { editor } = buildEditor();
    const byId = await loadSeed(editor);
    const loop = loopMembers(editor);
    expect(loop.has(byId.get("loopA")!.id)).toBe(true);
    expect(loop.has(byId.get("loopB")!.id)).toBe(true);
    // Downstream display is NOT a loop member — it receives the propagated
    // error rather than being dead-ended itself.
    expect(loop.has(byId.get("circDisp")!.id)).toBe(false);
  });

  it("hydrated composites carry their drill-in layout", async () => {
    const { editor } = buildEditor();
    const byId = await loadSeed(editor);
    const comp = byId.get("simComp") as CompositeNode;
    expect(editor.getNode(comp.id)).toBeDefined();
    // Every internal node got a position from the seed's x/y.
    for (const n of comp.internalEditor.getNodes()) {
      expect(comp.internalPositions[n.id], `no position for ${n.label}`).toBeDefined();
    }
  });
});
