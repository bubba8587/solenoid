import { describe, it, expect } from "vitest";
import { buildModel, toFlowNodes, toFlowEdges } from "./flowModel";
import { recompute } from "./flowController";
import { FLOW_SEEDS, DEFAULT_SEED_ID } from "./flowSeeds";
import { isSolError } from "../errorValue";

// C0 pin: a saved graph builds the headless model, computes, and projects into
// React-Flow-shaped nodes/edges with per-port handles intact.

describe("flow model (React Flow port C0)", () => {
  it("has seeds and a default", () => {
    expect(Object.keys(FLOW_SEEDS).length).toBeGreaterThan(0);
    expect(FLOW_SEEDS[DEFAULT_SEED_ID]).toBeDefined();
  });

  it("builds and computes the default seed", async () => {
    const g = FLOW_SEEDS[DEFAULT_SEED_ID].graph;
    const m = await buildModel(g);
    expect(m.editor.getNodes().length).toBe(g.nodes.length);
    expect(m.editor.getConnections().length).toBe(g.connections.length);

    const values = await recompute(m);
    expect(values.size).toBe(g.nodes.length);
    // The seed is a healthy graph: at least one node yields a real (non-error)
    // output value.
    const healthy = [...values.values()].some(
      (outs) => outs && Object.values(outs).some((v) => v !== undefined && !isSolError(v)),
    );
    expect(healthy).toBe(true);
  });

  it("projects RF nodes/edges with positions and handle ids", async () => {
    const g = FLOW_SEEDS[DEFAULT_SEED_ID].graph;
    const m = await buildModel(g);
    const nodes = toFlowNodes(m);
    const edges = toFlowEdges(m);

    expect(nodes.length).toBe(g.nodes.length);
    for (const n of nodes) {
      expect(n.type).toBe("sol");
      expect(Number.isFinite(n.position.x)).toBe(true);
      expect(Number.isFinite(n.position.y)).toBe(true);
      expect(n.data.node).toBeDefined();
    }

    expect(edges.length).toBe(g.connections.length);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (const e of edges) {
      const src = byId.get(e.source);
      const tgt = byId.get(e.target);
      expect(src, `edge source ${e.source}`).toBeDefined();
      expect(tgt, `edge target ${e.target}`).toBeDefined();
      // Handle ids are the socket keys — they must exist on the live node.
      const srcNode = src!.data.node as unknown as { outputs: Record<string, unknown> };
      const tgtNode = tgt!.data.node as unknown as { inputs: Record<string, unknown> };
      expect(srcNode.outputs[e.sourceHandle], `output ${e.sourceHandle}`).toBeDefined();
      expect(tgtNode.inputs[e.targetHandle], `input ${e.targetHandle}`).toBeDefined();
    }
  });

  it("round-trips every seed through the model without unknown types", async () => {
    for (const [id, s] of Object.entries(FLOW_SEEDS)) {
      const m = await buildModel(s.graph);
      expect(m.editor.getNodes().length, `seed ${id}`).toBe(s.graph.nodes.length);
    }
  });
});
