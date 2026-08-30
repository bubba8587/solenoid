import { describe, it, expect } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import * as Nodes from "../../src/graph/rete-nodes";
import type { Schemes } from "../../src/graph/schemes";
import { installInputCoercion } from "../../src/graph/coerceInputs";
import { installErrorGuards } from "../../src/graph/errorValue";
import { isCubeValue, isFrameValue, cubeDepth, cubeRowCount, frameRowCount, type CubeValue } from "../../src/graph/frame";
import seed from "../../src/graph/seedGraphs/cubes.json";

// Runs the Cubes showcase seed through a real editor + DataflowEngine (same
// coercion + error guards as Canvas) and checks it demonstrates what it claims:
// Nest Join nests Orders under each Rep, a cube-parent Nest Join deepens to
// Region→Rep→Orders (depth 2), INDEX reads cells back out, Unnest flattens, Cube
// Columns assembles a multi-column cube, and wrapping a cube climbs the depth.

type SavedNode = {
  id: string; type: string;
  init?: Record<string, unknown>;
  literals?: Record<string, number>;
  stringLiterals?: Record<string, string>;
};

describe("cubes seed", () => {
  it("nests, deepens, reads, unnests, assembles, and climbs depth as claimed", async () => {
    const editor = new NodeEditor<Schemes>();
    installInputCoercion(editor);
    editor.addPipe((ctx) => { if (ctx.type === "nodecreated") installErrorGuards(ctx.data); return ctx; });
    const engine = new DataflowEngine<Schemes>();
    editor.use(engine);

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
    const out = async (seedId: string) => (await engine.fetch(byId.get(seedId)!.id)) as Record<string, unknown>;

    // ── Nest Join (depth 1): Orders nested under each Rep ─────────────────────
    const repCube = (await out("nestRep")).cube as CubeValue;
    expect(isCubeValue(repCube)).toBe(true);
    expect(repCube.columns.map((c) => c.name)).toEqual(["Rep", "Region", "orders"]);
    expect(cubeRowCount(repCube)).toBe(4);
    expect(cubeDepth(repCube)).toBe(1);                  // nested cells are frames (leaves)
    expect(frameRowCount(repCube.columns[2].cells[0] as never)).toBe(9); // Ada's 9 orders

    // ── INDEX: a sub-frame and a scalar ──────────────────────────────────────
    expect(frameRowCount((await out("idxRepOrders")).result as never)).toBe(9);
    expect((await out("idxRepName")).result).toBe("Ada");

    // ── Cube-aware Nest Join (depth 2): Region → Rep → Orders ─────────────────
    const deep = (await out("nestDeep")).cube as CubeValue;
    expect(isCubeValue(deep)).toBe(true);
    expect(deep.columns.map((c) => c.name)).toEqual(["Region", "reps"]);
    expect(cubeRowCount(deep)).toBe(4);
    expect(cubeDepth(deep)).toBe(2);                     // reps cells are now cubes
    expect(isCubeValue(deep.columns[1].cells[0])).toBe(true); // North's reps is a cube
    expect(isCubeValue((await out("idxRegion")).result)).toBe(true);

    // ── Unnest: the depth-1 cube flattens to one row per order ───────────────
    expect(frameRowCount((await out("unnestRep")).frame as never)).toBe(36);

    // ── Cube Columns: a 2-column cube (count + the table itself) ─────────────
    const cols = (await out("cubeCols")).cube as CubeValue;
    expect(cols.columns.map((c) => c.name)).toEqual(["count", "table"]);
    expect(cubeRowCount(cols)).toBe(3);
    expect(cols.columns[0].cells).toEqual([4, 4, 36]);
    expect(isFrameValue(cols.columns[1].cells[2])).toBe(true);          // the Orders frame
    expect(frameRowCount(cols.columns[1].cells[2] as never)).toBe(36);

    // ── Depth: wrap the depth-2 cube → depth 3 ───────────────────────────────
    expect(cubeDepth((await out("deep3")).cube as CubeValue)).toBe(3);
  });
});
