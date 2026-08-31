import { describe, it, expect } from "vitest";
import { buildModel, toFlowNodes, toFlowEdges, toFlowPosition, fromFlowPosition } from "../../../src/graph/flow/flowModel";
import { computeAll } from "../../../src/graph/graphCompute";
import { FLOW_SEEDS, DEFAULT_SEED_ID } from "../../../src/graph/flow/flowSeeds";
import { isSolError } from "../../../src/graph/errorValue";

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

    const values = await computeAll(m.editor, m.engine);
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

// Groups are RF sub-flows: a member carries parentId and a position RELATIVE to its
// group's box (RF tows it with the group); the model itself stays absolute.
describe("group members as RF children", () => {
  // Live nodes mint their own ids; the loader remaps a group's saved member ids the
  // same way (persistence.ts idMap).
  async function groupedModel() {
    const seed = FLOW_SEEDS[DEFAULT_SEED_ID].graph;
    const leaf = seed.nodes.find((n) => n.type !== "GroupNode")!;
    const m = await buildModel({
      v: seed.v,
      nodes: [
        { ...leaf, id: "m1", x: 150, y: 180 },
        { id: "g", type: "GroupNode", x: 100, y: 100, init: { members: ["m1"], width: 300, height: 200 } },
      ],
      connections: [],
    });
    const group = m.editor.getNodes().find((n) => n.constructor.name === "GroupNode") as unknown as { id: string; members: string[] };
    const member = m.editor.getNodes().find((n) => n.constructor.name !== "GroupNode")!;
    group.members = [member.id];
    return { m, g: group.id, m1: member.id };
  }

  it("projects a member relative to its group, group first", async () => {
    const { m, g, m1 } = await groupedModel();
    const nodes = toFlowNodes(m);
    expect(nodes.map((n) => n.id)).toEqual([g, m1]);
    expect(nodes[1].parentId).toBe(g);
    expect(nodes[1].position).toEqual({ x: 50, y: 80 });
    expect(nodes[0].parentId).toBeUndefined();
    expect(nodes[0].position).toEqual({ x: 100, y: 100 });
  });

  it("converts both ways at the boundary", async () => {
    const { m, g, m1 } = await groupedModel();
    expect(toFlowPosition(m, m1, { x: 160, y: 190 })).toEqual({ x: 60, y: 90 });
    expect(toFlowPosition(m, g, { x: 160, y: 190 })).toEqual({ x: 160, y: 190 });
    expect(fromFlowPosition(m, { x: 60, y: 90 }, g)).toEqual({ x: 160, y: 190 });
    expect(fromFlowPosition(m, { x: 60, y: 90 }, undefined)).toEqual({ x: 60, y: 90 });
  });
});
