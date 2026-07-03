import { describe, it, expect } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import * as Nodes from "./rete-nodes";
import type { Schemes } from "./schemes";
import { installInputCoercion } from "./coerceInputs";
import { installErrorGuards } from "./errorValue";
import { isCubeValue, type CubeValue, type FrameValue } from "./frame";
import seed from "./seedGraphs/bom-costing.json";

// Runs the BOM/nested-costing seed through a real editor + DataflowEngine (same
// coercion + error guards as Canvas) and checks the two-level roll-up (Parts →
// Subassemblies → Products, both nested via Nest Join + Cube Rollup) computes the
// right totals — and that editing a leaf part's UnitCost ripples correctly through
// BOTH levels, reweighted by quantity at each level.

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

describe("BOM costing seed", () => {
  it("rolls up SUM(Quantity × UnitCost) through two nested levels", async () => {
    const { editor, engine } = buildEditor();
    const byId = await loadSeed(editor);
    const out = async (id: string) => (await engine.fetch(byId.get(id)!.id)) as Record<string, unknown>;

    // Subassembly level: Door Panel = 6×0.5 (Bolt) + 2×2.25 (Hinge) = 7.50;
    // Drawer Slide = 4×0.5 (Bolt) + 8×0.10 (Screw) = 2.80.
    const subCube = (await out("nestSub")).cube as CubeValue;
    expect(isCubeValue(subCube)).toBe(true);
    const subCost = (await out("rollupSub")).frame as FrameValue;
    expect(subCost.columns.find((c) => c.name === "SubassemblyID")?.values).toEqual(["SA1", "SA2"]);
    expect(subCost.columns.find((c) => c.name === "Cost")?.values).toEqual([7.5, 2.8]);

    // Product level: Cabinet = 2×7.50 (Door Panel) + 1×2.80 (Drawer Slide) = 17.80;
    // Nightstand = 2×2.80 (Drawer Slide) = 5.60.
    const prodCube = (await out("nestProd")).cube as CubeValue;
    expect(isCubeValue(prodCube)).toBe(true);
    const prodCost = (await out("rollupProd")).frame as FrameValue;
    expect(prodCost.columns.find((c) => c.name === "ProductID")?.values).toEqual(["PR1", "PR2"]);
    expect(prodCost.columns.find((c) => c.name === "TotalCost")?.values).toEqual([17.8, 5.6]);
  });

  it("ripples a leaf part's price change through both nested levels", async () => {
    const { editor, engine } = buildEditor();
    const byId = await loadSeed(editor);
    const partsNode = byId.get("parts") as unknown as { frameText: string };

    // Bolt (PT1) is used by BOTH subassemblies — raise its UnitCost 0.5 → 1.0.
    partsNode.frameText = partsNode.frameText.replace('"values":[0.5,3,2.25,0.1]', '"values":[1,3,2.25,0.1]');
    engine.reset();

    const subCost = (await engine.fetch(byId.get("rollupSub")!.id) as Record<string, unknown>).frame as FrameValue;
    // Door Panel = 6×1 + 2×2.25 = 10.50; Drawer Slide = 4×1 + 8×0.10 = 4.80.
    expect(subCost.columns.find((c) => c.name === "Cost")?.values).toEqual([10.5, 4.8]);

    const prodCost = (await engine.fetch(byId.get("rollupProd")!.id) as Record<string, unknown>).frame as FrameValue;
    // Cabinet = 2×10.50 + 1×4.80 = 25.80; Nightstand = 2×4.80 = 9.60 — both moved,
    // reweighted by how many of each subassembly each product uses.
    expect(prodCost.columns.find((c) => c.name === "TotalCost")?.values).toEqual([25.8, 9.6]);
  });
});
